// The talk page's transcript: a bounded, in-memory ring of the lines a session's Discord thread
// carries, keyed by lineage, and the view the page polls. Nothing here is written to disk, so a
// broker restart empties every ring and `seq` starts again at 1.
//
// The ring is fed by two taps: the outbound router for what reaches a thread from a session, and the
// inbound router for what a session is handed. Narration is not tapped, so the ring holds landed
// replies and never the interim text Discord edits in place.
import { liveByLineage } from "../registry.ts";
import type { SessionRecord } from "../registry.ts";
import { jumpLink } from "../discord/links.ts";
import type { RosterPersona } from "../board/roster.ts";
import type { ReceiptStage } from "../routing/receipts.ts";
import type { QuestionEntryView } from "../question-desk.ts";
import type { PendingPermission } from "../security/permission.ts";
import { answerableFromThread } from "../discord/question-message.ts";
import { visible, withoutInvisible } from "../sanitize.ts";

/** How many lines a lineage's ring keeps; the oldest is dropped when a newer one would pass it. */
export const RING_CAPACITY = 200;

/** The longest author a line keeps, in UTF-16 units; the same bound the Discord draw puts on a peer's name. */
const MAX_AUTHOR = 240;

/**
 * What a line is. `reply` is a reply-tool post and `mirror` the Stop hook's copy of a turn's closing
 * reply, both the session's words. `prompt` is the operator's own typed prompt as the session read
 * it at the console, `peer` a message to or from another session, `question` the notice a held
 * question raises, `inbound` a line handed to the session from Discord and `notice` a broker-composed
 * one-liner such as a finished background task.
 */
export type TalkKind = "reply" | "mirror" | "prompt" | "peer" | "question" | "inbound" | "notice";

/** The class the sender roster gives the writer of an `inbound` line; null where no person wrote it. */
export type TalkSenderClass = "operator" | "participant" | null;

/**
 * A file a line carries: its reduced name, its size in bytes, and the page's `/web/file/<id>` link
 * to the copy the broker keeps. The link's id is held in memory, so after a restart the name and
 * size still read and the link answers 404.
 */
export type TalkFile = { name: string; size: number; url: string };

/**
 * How far an `inbound` line has got with the session, as the receipt tracker stages it: handed over,
 * picked up by a turn, answered, or warned while the session is in a harness error episode. Null for
 * any other kind, for a line the tracker never saw, and for a line whose Discord post failed, since
 * a stage is painted on a thread message and that line has none.
 */
export type TalkReceipt = ReceiptStage | null;

/**
 * One entry in a ring. `author` is who wrote it where a person or a peer did, and null for the
 * session's own words. `at` is the ring's clock in epoch milliseconds when the line was pushed.
 */
export type TalkLine = {
  seq: number;
  at: number;
  kind: TalkKind;
  author: string | null;
  senderClass: TalkSenderClass;
  text: string;
  files: TalkFile[];
  receipt: TalkReceipt;
};

/**
 * What a tap hands the ring; the ring stamps `seq` and `at`. `files` are the files the line carries,
 * none where it is absent. `tracked` is the thread message the receipt tracker stages this line
 * under, for a line it tracks; the view reads the line's `receipt` through it, and a line with none
 * reads null.
 */
export type TalkInput = {
  kind: TalkKind;
  author: string | null;
  senderClass: TalkSenderClass;
  text: string;
  files?: readonly TalkFile[];
  tracked?: { threadId: string; messageId: string } | null;
};

/** The seam the routers push through, so they import a type and never the ring. */
export type TalkTap = {
  push: (lineage: string, input: TalkInput) => unknown;
};

/** A line as the ring holds it: the view's shape, with the key its receipt is read by. */
export type HeldLine = TalkLine & { tracked: { threadId: string; messageId: string } | null };

export type TalkRing = {
  /** Appends a line to the lineage's ring and returns it. */
  push: (lineage: string, input: TalkInput) => HeldLine;
  /** The lines whose `seq` is greater than `afterSeq`, oldest first. */
  since: (lineage: string, afterSeq: number) => HeldLine[];
  /** The highest `seq` the lineage has been given, or 0 where it has none. Not lowered by a drop. */
  newestSeq: (lineage: string) => number;
  /** When this ring was created, as an ISO time; the same for every lineage and every read. */
  startedAt: string;
};

export type TalkRingOptions = {
  capacity?: number;
  /** The clock a line is stamped with. Injected so a test fixes it. */
  now?: () => number;
};

type Ring = { lines: HeldLine[]; newest: number };

export function createTalkRing(options: TalkRingOptions = {}): TalkRing {
  const capacity = options.capacity ?? RING_CAPACITY;
  const now = options.now ?? Date.now;
  const rings = new Map<string, Ring>();
  const startedAt = new Date(now()).toISOString();

  return {
    push(lineage, input) {
      let ring = rings.get(lineage);
      if (ring === undefined) {
        ring = { lines: [], newest: 0 };
        rings.set(lineage, ring);
      }
      ring.newest += 1;
      const line: HeldLine = {
        seq: ring.newest,
        at: now(),
        kind: input.kind,
        author: input.author === null ? null : input.author.slice(0, MAX_AUTHOR),
        senderClass: input.senderClass,
        text: input.text,
        files: (input.files ?? []).map((file) => ({ name: file.name, size: file.size, url: file.url })),
        receipt: null,
        tracked: input.tracked ?? null,
      };
      ring.lines.push(line);
      if (ring.lines.length > capacity) ring.lines.splice(0, ring.lines.length - capacity);
      return line;
    },
    since(lineage, afterSeq) {
      const ring = rings.get(lineage);
      if (ring === undefined) return [];
      return ring.lines.filter((line) => line.seq > afterSeq);
    },
    newestSeq(lineage) {
      return rings.get(lineage)?.newest ?? 0;
    },
    startedAt,
  };
}

/**
 * Whether a lineage may be asked for: some registry record in any state carries it, or the roster,
 * where one is configured, names a persona by it. A broker with no roster reading answers by the
 * registry alone.
 */
export function lineageKnown(
  records: readonly SessionRecord[],
  roster: readonly RosterPersona[] | null,
  lineage: string,
): boolean {
  if (records.some((record) => record.lineage === lineage)) return true;
  return roster !== null && roster.some((persona) => persona.name === lineage);
}

export type TalkSession = {
  sessionId: string;
  state: SessionRecord["state"];
  threadId: string | null;
  /** The thread's Discord link, or null where the session has no thread or no guild is configured. */
  threadLink: string | null;
};

export type TalkView = {
  lineage: string;
  session: TalkSession | null;
  lines: TalkLine[];
  /** The newest `seq` in the ring: the value the page sends as `since` on its next poll. */
  nextSeq: number;
  /** When the ring was created: a page holding a different value knows the broker restarted. */
  ringStart: string;
  /** What the lineage's live session is held on; both lists are empty where no session is live. */
  pending: { questions: TalkQuestion[]; permissions: TalkPermission[] };
  /** Every lineage a live record carries, the opened one first and then by name. */
  lineages: string[];
  asOf: string;
};

/**
 * One option of a held question as the page draws it. `index` is the option's position in the ask,
 * which is what a pick sends back; `label` is the label the thread's picker shows for it, and
 * `chosen` whether the entry's selection holds it now.
 */
export type TalkQuestionOption = { index: number; label: string; description: string | null; chosen: boolean };

/**
 * One held ask. `answerable` is `answerableFromThread` over the entry, the rule the Discord thread
 * draws its picker under: false, the page offers only the console release. `alerted` is whether the
 * thread's alert has landed, which a typed answer needs.
 */
export type TalkQuestion = {
  entryId: string;
  answerable: boolean;
  alerted: boolean;
  questions: Array<{ header: string | null; question: string; multiSelect: boolean; options: TalkQuestionOption[] }>;
};

/** One open permission request, its untrusted text stripped of invisibles. */
export type TalkPermission = PendingPermission;

export type TalkViewInput = {
  lineage: string;
  since: number;
  records: readonly SessionRecord[];
  threadFor: (sessionId: string) => string | null;
  guildId: () => string | null;
  /** The receipt tracker's stage for a thread message; absent, every line reads `receipt: null`. */
  stageOf?: (threadId: string, messageId: string) => ReceiptStage | null;
  /** The question desk's held entry for a session; absent, the view carries no question. */
  questionsFor?: (sessionId: string) => readonly QuestionEntryView[];
  /** The permission desk's open requests for a session; absent, the view carries no permission. */
  permissionsFor?: (sessionId: string) => readonly PendingPermission[];
  now: number;
};

/**
 * A held entry as the page draws it, its text stripped of invisibles and uncut, since nothing is
 * posted. An option whose label strips to nothing is left out, as the thread's picker leaves it out,
 * and every other one keeps its position in the ask.
 */
function viewQuestion(entry: QuestionEntryView): TalkQuestion {
  return {
    entryId: entry.id,
    answerable: answerableFromThread(entry.questions, entry.questionsInput),
    alerted: entry.alert !== null,
    questions: entry.questions.map((asked, at) => {
      const chosen = chosenPositions(asked.options, entry.selections[at] ?? []);
      return {
        header: asked.header === null ? null : visible(asked.header),
        question: visible(asked.question),
        multiSelect: asked.multiSelect,
        options: asked.options.flatMap((option, index) => {
          const label = visible(option.label);
          if (label === "") return [];
          return [{
            index,
            label,
            description: option.description === null ? null : visible(option.description),
            chosen: chosen.has(index),
          }];
        }),
      };
    }),
  };
}

/**
 * The option positions a question's held picks name. The desk holds a pick as its label, so each
 * held label takes the first position carrying that label that no earlier label took: one pick of
 * a label two options share marks one option, and two picks of it mark both.
 */
function chosenPositions(options: readonly { label: string }[], picks: readonly string[]): Set<number> {
  const chosen = new Set<number>();
  for (const pick of picks) {
    const at = options.findIndex((option, index) => option.label === pick && !chosen.has(index));
    if (at >= 0) chosen.add(at);
  }
  return chosen;
}

/** An open request as the page draws it: invisibles stripped, line breaks kept, and nothing cut. */
function viewPermission(request: PendingPermission): TalkPermission {
  return {
    ...request,
    toolName: visible(request.toolName),
    description: withoutInvisible(request.description),
    inputPreview: withoutInvisible(request.inputPreview),
  };
}

/** The line as the view carries it: the receipt read now from the tracker, and the key left out. */
function viewLine(line: HeldLine, stageOf: TalkViewInput["stageOf"]): TalkLine {
  const { tracked, ...shown } = line;
  const receipt = tracked === null || stageOf === undefined ? null : stageOf(tracked.threadId, tracked.messageId);
  return { ...shown, receipt };
}

export function talkView(ring: TalkRing, input: TalkViewInput): TalkView {
  const live = liveByLineage(input.records, input.lineage);
  let session: TalkSession | null = null;
  const pending: TalkView["pending"] = { questions: [], permissions: [] };
  if (live !== null) {
    pending.questions = (input.questionsFor?.(live.sessionId) ?? []).map(viewQuestion);
    pending.permissions = (input.permissionsFor?.(live.sessionId) ?? []).map(viewPermission);
    const threadId = input.threadFor(live.sessionId);
    session = {
      sessionId: live.sessionId,
      state: live.state,
      threadId,
      threadLink: jumpLink(input.guildId(), threadId, null),
    };
  }
  const others = new Set<string>();
  for (const record of input.records) {
    if (record.state !== "ended" && record.lineage !== null && record.lineage !== input.lineage) {
      others.add(record.lineage);
    }
  }
  return {
    lineage: input.lineage,
    session,
    lines: ring.since(input.lineage, input.since).map((line) => viewLine(line, input.stageOf)),
    nextSeq: ring.newestSeq(input.lineage),
    ringStart: ring.startedAt,
    pending,
    lineages: [input.lineage, ...[...others].sort()],
    asOf: new Date(input.now).toISOString(),
  };
}
