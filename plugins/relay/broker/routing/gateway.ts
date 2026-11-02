// The inbound half of the Discord connection: a gateway client that reports messages posted in the
// threads this broker owns, and clears the pin notices its own pins write into the channel.
//
// The other notice this bot causes, the one a rename writes into a thread, stays where it lands: an
// application cannot delete a system message of that kind (Discord answers 403 with error 50021),
// so the broker does not ask.
//
// This is the only file in the routing layer that imports discord.js, mirroring broker/discord/
// rest.ts. Everything above it works against `onMessage` and `deleteMessage`, so the routing and
// its refusals are testable without a library, a token, or a network. What it classifies it
// forwards, and every decision about a message bound for a session lives in one place
// (inbound.ts). The one decision made here is the delete, because it belongs to a message that
// reaches no session at all: it is a system message this bot wrote, and the facts it turns on are
// the library's own.
import { ChannelType, Client, Events, GatewayIntentBits, MessageReferenceType, MessageType, Partials } from "discord.js";
import type {
  InternalDiscordGatewayAdapterCreator,
  Message,
  MessageReaction,
  OmitPartialGroupDMChannel,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import { describe } from "../discord/rest.ts";
import { boundedAuthor } from "../sanitize.ts";
import type { CallOutcome } from "../discord/transport.ts";
import type { InboundAttachment } from "./attachments.ts";
import { REACTION_HOLD_MS } from "./inbound.ts";
import type { InboundMessage, InboundReaction, ReactionAction, ReactionKey } from "./inbound.ts";
import type { InboundInteraction } from "./interactions.ts";
import type { Quote } from "./response-gate.ts";

export type MessageSource = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /**
   * The guild the configured channel sits in, or null until the connection's channel cache holds
   * it. Looked up in that cache on every call rather than latched once, so a cache that was cold
   * when this was last read still heals on the next: the Guilds intent populates it without a REST
   * call, but nothing guarantees the channel is cached by any one fixed point in the connection's
   * life.
   */
  guildId: () => string | null;
  /** What the voice module reads off this connection, or null while `CHANNEL_VOICE` is off. */
  voice: VoiceGateway | null;
};

/** One account's voice-channel move in the configured channel's guild, by channel id. */
export type VoiceStateChange = { userId: string; before: string | null; after: string | null };

/**
 * The voice module's view of the gateway connection, read from the voice-state cache the
 * `GuildVoiceStates` intent fills. Every lookup is in the configured channel's guild, so two brokers
 * sharing a client library never see each other's guilds. Typed with no voice library in it, so the
 * gateway loads none.
 */
export type VoiceGateway = {
  /** The configured channel's guild, or null until the channel cache holds it. */
  guildId: () => string | null;
  /** The guild's voice adapter, through which a voice connection signals over this gateway. */
  adapterCreator: () => InternalDiscordGatewayAdapterCreator | null;
  /** The voice channel the account sits in, or null for none or for a stage channel. */
  channelOf: (userId: string) => string | null;
  /** This bot's own account, or null while the connection has not identified yet. */
  selfId: () => string | null;
  /** Every account sitting in the voice channel. */
  membersOf: (channelId: string) => readonly string[];
  /**
   * The name an account in the guild's voice-state cache is attributed to, by `authorName`, or
   * null for an account the cache does not hold.
   */
  nameOf: (userId: string) => string | null;
  /** Calls `listener` on every voice-state change in the guild, until the returned function runs. */
  onVoiceState: (listener: (change: VoiceStateChange) => void) => () => void;
};

/**
 * The voice channel an account's voice state places it in, offered only where that channel is an
 * ordinary voice channel. A stage channel answers null, so `voice on` from a stage gets the
 * no-channel notice: the bot would join a stage as an audience member and could not speak.
 */
export function voiceChannelOf(
  state: { channelId: string | null; channel: { type: ChannelType } | null } | undefined,
): string | null {
  if (state === undefined || state.channelId === null) return null;
  return state.channel?.type === ChannelType.GuildVoice ? state.channelId : null;
}

/**
 * The gateway intents this broker requests. Guilds gives the client its channel cache, which is what
 * makes a thread's parent readable without a REST call per message. MessageContent is privileged and
 * must be enabled on the application, or every message arrives with an empty body and the channel
 * looks silently dead. GuildMessageReactions delivers the reactions added to and removed from
 * messages in the guild, and is not privileged. GuildVoiceStates is requested only with the voice
 * on: it fills the voice-state cache that says which channel an operator sits in.
 */
export function gatewayIntents(voice: boolean): GatewayIntentBits[] {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ];
  if (voice) intents.push(GatewayIntentBits.GuildVoiceStates);
  return intents;
}

/**
 * How long a refused delete waits before the same line may be written again.
 *
 * Wide, because the refusal it reports is a standing one: a host whose bot may not delete takes it
 * on every notice its own writes cause, and the line says the same thing each time.
 */
const REFUSAL_WINDOW_MS = 5 * 60 * 1000;

/**
 * One arriving message reduced to the facts the routing decision reads, so that decision is a
 * function of values rather than of a library object.
 */
export type MessageFacts = {
  /** Where it was posted, which for a message in a thread is that thread's own id. */
  channelId: string;
  /** The thread's parent channel, and null for a message that is in no thread. */
  parentId: string | null;
  inThread: boolean;
  /**
   * Discord's message type. `ChannelPinnedMessage` is the notice a pin writes, and
   * `ChannelNameChange` the one a rename writes.
   */
  type: MessageType;
  authorId: string;
  /** This bot's own user, and null while the connection has not identified yet. */
  selfId: string | null;
};

/**
 * What happens to one message: it is delivered to the session whose thread it landed in, deleted as
 * a system notice this bot's own write caused, or dropped.
 */
export type MessageDecision = "deliver" | "delete" | "drop" | "report";

/**
 * The single decision made about an arriving message.
 *
 * A message outside a thread is deleted or dropped, and only a message inside one is ever
 * delivered. That split is what keeps the inbound route, the sender gate, and the permission
 * verdict reader exactly as unreachable from the parent channel as they are for a broker that
 * deletes nothing: the channel's one path ends at the delete.
 *
 * One notice is deleted, the one a pin writes into the channel, and the gate is as narrow as the
 * notice allows because the delete is irreversible and the channel is the operator's own: this
 * host's channel, Discord's type for that notice, and this bot as the author, all three. A notice
 * behind a pin the operator made by hand carries their user id and is left where it is, a broker
 * sharing the guild deletes nothing here, and no message's content is read at all.
 */
export function classifyMessage(facts: MessageFacts, channelId: string): MessageDecision {
  if (!facts.inThread) {
    if (facts.channelId !== channelId) return "drop";
    if (facts.selfId === null || facts.authorId !== facts.selfId) return "drop";
    if (facts.type === MessageType.ChannelPinnedMessage) return "delete";
    // An ordinary message is this broker's own card, posted here every time a session opens, so it
    // is dropped in silence. A system message that is not the pin notice is the case worth a line:
    // the pin is issued on Discord's message-scoped route, which is newer than the notice type
    // named above, so a route that ever announced itself differently would leave this cleaner
    // deleting nothing while reporting nothing either. That is an absence indistinguishable from
    // success, and this is what tells the two apart.
    return facts.type === MessageType.Default ? "drop" : "report";
  }
  // Threads only, and only threads opened in this host's channel. Two brokers can share a guild,
  // and a message in one host's channel must not be offered to another host's sessions.
  if (facts.parentId !== channelId) return "drop";
  // The notice Discord writes into a thread each time its name changes, whoever renamed it.
  //
  // Dropped rather than deleted, because an application cannot delete a system message of this kind
  // (Discord answers 403 with error 50021, where a human account holding Manage Messages may), and
  // dropped rather than delivered, because it carries no text a session could act on: what it says
  // is drawn by Discord from the new name, not written by the operator.
  if (facts.type === MessageType.ChannelNameChange) return "drop";
  return "deliver";
}

/**
 * The name a delivered message is attributed to: the member nickname, else the global name, else the
 * username, each bounded by `boundedAuthor` before it is weighed. A name that bounds to nothing a
 * person could read falls to the next, and with none left the author's ID stands in, so the event
 * always names someone.
 */
export function authorName(author: {
  id: string;
  nickname: string | null;
  globalName: string | null;
  username: string;
}): string {
  for (const name of [author.nickname, author.globalName, author.username]) {
    if (name === null) continue;
    const bounded = boundedAuthor(name);
    if (bounded !== "") return bounded;
  }
  return author.id;
}

/**
 * How a message stands to this bot's own user, from the facts the library reports: who wrote it,
 * the users it mentions and the author of the message it replies to.
 *
 * A mention is a direct user mention of the bot's own id. A role mention or an @everyone names a
 * group the bot may belong to and is not one, since neither is a person asking the bot. A reply is
 * to the bot when the message it references was the bot's, which the library reports from the
 * referenced message's author whether or not the reply pinged them; a reply whose referenced
 * message is gone reports no author, and is not a reply to the bot. A message is the bot's own when
 * its author is the bot's own user, which is narrower than the author being any bot: another bot or
 * a webhook in the thread is neither this bot nor the assistant. Before the connection has
 * identified itself there is no self to match, so nothing addresses it and nothing is its own.
 */
export function addressing(facts: {
  selfId: string | null;
  authorId: string;
  mentionedUserIds: readonly string[];
  repliedToAuthorId: string | null;
}): { mentionsBot: boolean; repliesToBot: boolean; fromSelf: boolean } {
  if (facts.selfId === null) return { mentionsBot: false, repliesToBot: false, fromSelf: false };
  return {
    mentionsBot: facts.mentionedUserIds.includes(facts.selfId),
    repliesToBot: facts.repliedToAuthorId === facts.selfId,
    fromSelf: facts.authorId === facts.selfId,
  };
}

/**
 * A message's attachments as the router takes them: every one Discord listed, in its order, with
 * the five fields the intake reads and nothing else. Nothing is decided or cut here, since what may
 * come in is the intake's question and a file it refuses is named back to the thread. Discord's
 * own `proxyURL` is not carried, so the one address the intake can ever fetch is `url`.
 */
export function attachmentsOf(
  attachments: Iterable<{
    id: string;
    name: string;
    size: number;
    contentType: string | null;
    url: string;
  }>,
): InboundAttachment[] {
  return [...attachments].map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    contentType: attachment.contentType,
    url: attachment.url,
  }));
}

/** The part of a library message its reply link is read from. */
export type ReplyLink = {
  type: MessageType;
  reference: { messageId: string | undefined; type: MessageReferenceType | undefined } | null;
  channel: {
    messages: {
      cache: {
        get: (id: string) =>
          | {
              partial: boolean;
              createdTimestamp: number;
              content: string;
              author: { id: string; globalName: string | null; username: string };
              member: { nickname: string | null } | null;
            }
          | undefined;
      };
    };
  };
};

/**
 * The message a reply points at, as routing quotes it, or null for a message that is no reply.
 *
 * A reply is Discord's reply type with a reference naming a message and not typed a forward. The
 * reference's type is optional on the wire and the library passes it on as it arrives, so a
 * reference with no type is a reply's. A forward names a message too and is no reply to it, and a
 * system notice such as a pin carries a reference to the message it is about, so neither is quoted.
 * The read is the channel's message cache alone, where the library puts the referenced message
 * whenever Discord sends it with the reply, and a reply it did not come with reads as gone. It is
 * never a fetch: the library's fetch falls back to a REST call with its full retry budget, and a
 * wait of that length would hold the reply, and every message routing takes after it, behind a read
 * the quote does not need. A message the cache does not hold, or holds only partly, is the gone
 * marker, so a deleted message reads as gone and the reply still reaches routing. The author is
 * named by `authorName`, as a message's own author is.
 */
export function repliedToOf(message: ReplyLink): Quote | null {
  const reference = message.reference;
  if (message.type !== MessageType.Reply || reference === null) return null;
  if (reference.type === MessageReferenceType.Forward || reference.messageId === undefined) return null;
  const referenced = message.channel.messages.cache.get(reference.messageId);
  if (referenced === undefined || referenced.partial) return { kind: "gone" };
  return {
    kind: "message",
    author: authorName({
      id: referenced.author.id,
      nickname: referenced.member?.nickname ?? null,
      globalName: referenced.author.globalName,
      username: referenced.author.username,
    }),
    at: referenced.createdTimestamp,
    text: referenced.content,
  };
}

/** Distinct unexpected system message types one connection names before it goes quiet. */
const MAX_REPORTED_TYPES = 16;

/**
 * Names a system message this bot caused in the channel that is not the pin notice the cleaner
 * removes, once per distinct type.
 *
 * The type is the whole of what is worth knowing, and a second line of the same one restates it, so
 * each is named once and the count is bounded. Nothing about the message's content is read.
 */
export function createUnexpectedSystemReport(log: (message: string) => void): (type: number) => void {
  const named = new Set<number>();
  return (type) => {
    if (named.has(type) || named.size >= MAX_REPORTED_TYPES) return;
    named.add(type);
    log(
      `gateway: this bot wrote a system message of type ${String(type)} in the channel, which is ` +
        "not the pin notice the cleaner removes",
    );
  };
}

/**
 * Which notice a delete is for: the one a pin writes into the channel. A union rather than a
 * string, because the kind names the line an operator reads and the latch below is held per kind,
 * so a spelling this broker does not write is a type error here rather than a nonsense line in the
 * log.
 */
export type SystemNoticeKind = "pin";

export type SystemNoticeCleanerOptions = {
  deleteMessage: (input: { messageId: string }) => Promise<CallOutcome<null>>;
  log: (message: string) => void;
  now: () => number;
};

/**
 * Deletes one system notice, once.
 *
 * A refusal costs a notice that stays where it landed, which is the surface a broker without this
 * has, so nothing is ever retried: the notice is cosmetic and the budget a retry would spend is
 * shared with the writes that reach a phone. The line reporting it is held to one per window, with
 * what it swallowed counted into the next one that gets through, and it names the kind because the
 * kind is what says which of this bot's writes is leaving a trace.
 *
 * A refusal Discord marks permanent latches that kind off for the rest of the run, and only that
 * kind: the same call is refused the same way on every later pass, so an unlatched kind would spend
 * one refused request per notice forever against the invalid-request budget whose overrun is an
 * hour-long ban on this host's whole connection. That latch takes a line of its own, once for the
 * kind and past the window, because a kind that is no longer cleaned is a standing change in what
 * the channel shows and the run may write nothing else about it.
 */
export function createSystemNoticeCleaner(
  options: SystemNoticeCleanerOptions,
): (notice: { kind: SystemNoticeKind; messageId: string }) => Promise<void> {
  let loggedAt: number | null = null;
  let suppressed = 0;
  const latched = new Set<SystemNoticeKind>();

  return async ({ kind, messageId }) => {
    if (latched.has(kind)) return;

    let refusal: string | null = null;
    let permanent = false;
    try {
      const outcome = await options.deleteMessage({ messageId });
      if (outcome.status === "rate-limited") refusal = "the bucket is empty";
      if (outcome.status === "failed") {
        refusal = outcome.error;
        // A 404 carries `permanent` too, because the identifier this call named will never resolve.
        // It says nothing about the next notice, though: one notice the operator already removed by
        // hand is not a standing refusal, and latching on it would take the cleaner down for the
        // rest of the run on the strength of a single vanished message.
        permanent = outcome.permanent === true && outcome.missing !== true;
      }
    } catch (error) {
      refusal = describe(error);
    }
    if (refusal === null) return;

    const at = options.now();
    if (!permanent && loggedAt !== null && at - loggedAt < REFUSAL_WINDOW_MS) {
      suppressed += 1;
      return;
    }
    const more = suppressed === 0 ? "" : ` (and ${String(suppressed)} more since the last line)`;
    const latch = permanent ? `. No ${kind} notice is cleaned for the rest of this run` : "";
    if (permanent) latched.add(kind);
    options.log(`gateway: deleting a ${kind} notice was refused: ${refusal}${more}${latch}`);
    loggedAt = at;
    suppressed = 0;
  };
}

export type GatewayOptions = {
  token: string;
  /** The channel this host's threads live in. A message anywhere else is not this broker's. */
  channelId: string;
  onMessage: (message: InboundMessage) => Promise<void>;
  /**
   * One component press in a thread this broker owns. Optional for the reason the routing layer's
   * other seams are optional: a broker whose questions are not answerable from the thread wires
   * none, and then interactions are classified nowhere rather than routed into a handler that
   * refuses them.
   *
   * The event needs no gateway intent of its own: interactions are delivered to the application
   * that owns the components, which is why nothing is added to the intent list below.
   */
  onInteraction?: (interaction: InboundInteraction) => Promise<void>;
  /**
   * The routing seams a reaction added or removed in a thread this broker owns reaches. Optional
   * for the reason `onInteraction` is: a broker that wires none registers no reaction handler at
   * all.
   */
  reactions?: ReactionRouting;
  /**
   * Deletes a message in the host's channel. Spent on one thing, append-only where what it
   * describes is reconciled: the system message Discord writes whenever this bot pins, so the
   * channel fills with notices about pins that are no longer held.
   */
  deleteMessage: (input: { messageId: string }) => Promise<CallOutcome<null>>;
  /** Whether `CHANNEL_VOICE` is on, which adds the voice intent and the voice surface. */
  voice?: boolean;
  log?: (message: string) => void;
};

/** What the message handler reads besides the message: the routing seams and this bot's own user. */
export type MessageListenerOptions = Pick<GatewayOptions, "channelId" | "onMessage" | "deleteMessage"> & {
  /** This bot's own user, and null while the connection has not identified yet. */
  selfId: () => string | null;
  log: (message: string) => void;
};

/**
 * The connection's `MessageCreate` handler. Every message takes one decision and is then handed to
 * what that decision names, so the paths out of here are the ones `classifyMessage` allows and
 * there is no other. A delivered message reaches `onMessage` in the turn it arrived, since nothing
 * on the way is awaited, so a thread's messages reach routing in the order Discord sent them.
 */
export function createMessageListener(
  options: MessageListenerOptions,
): (message: OmitPartialGroupDMChannel<Message>) => void {
  const log = options.log;
  const cleanNotice = createSystemNoticeCleaner({
    deleteMessage: options.deleteMessage,
    log,
    now: Date.now,
  });
  const reportUnexpectedSystem = createUnexpectedSystemReport(log);

  return (message) => {
    const channel = message.channel;
    const inThread = channel.isThread();
    const selfId = options.selfId();
    const decision = classifyMessage(
      {
        channelId: message.channelId,
        parentId: inThread ? channel.parentId : null,
        inThread,
        type: message.type,
        authorId: message.author.id,
        selfId,
      },
      options.channelId,
    );
    if (decision === "drop") return;
    if (decision === "report") {
      reportUnexpectedSystem(message.type);
      return;
    }
    if (decision === "delete") {
      // A pin notice lives in the channel the delete route already points at, so it carries no
      // channel of its own.
      void cleanNotice({ kind: "pin", messageId: message.id });
      return;
    }

    const addressed = addressing({
      selfId,
      authorId: message.author.id,
      mentionedUserIds: [...message.mentions.users.keys()],
      // The library fills this from the referenced message's author, whether or not the reply
      // pinged them, and leaves it null where that message is gone.
      repliedToAuthorId: message.mentions.repliedUser?.id ?? null,
    });
    // A bot's message is dropped by routing before anything reads a quotation, so its reply link
    // is not read at all.
    const repliedTo = message.author.bot ? null : repliedToOf(message);
    void options
      .onMessage({
        threadId: message.channelId,
        messageId: message.id,
        senderId: message.author.id,
        author: authorName({
          id: message.author.id,
          nickname: message.member?.nickname ?? null,
          globalName: message.author.globalName,
          username: message.author.username,
        }),
        // Reported rather than filtered here: every message this broker writes comes back over
        // this connection, and dropping it is a routing decision like any other.
        fromBot: message.author.bot,
        // Reported on the same terms: whether the message addresses the bot, or is the bot's own,
        // is a fact the routing reads, and what it does with one is decided there.
        fromSelf: addressed.fromSelf,
        mentionsBot: addressed.mentionsBot,
        repliesToBot: addressed.repliesToBot,
        text: message.content,
        attachments: attachmentsOf(message.attachments.values()),
        ...(repliedTo === null ? {} : { repliedTo }),
      })
      .catch((error: unknown) => {
        log(`gateway: routing an inbound message failed: ${describe(error)}`);
      });
  };
}

/**
 * A reaction's emoji as the line names it: the character itself for a standard emoji, and
 * `:name:` for a custom one. Null where the library reports no name, which no line can name.
 */
export function emojiName(emoji: { id: string | null; name: string | null }): string | null {
  if (emoji.name === null || emoji.name === "") return null;
  return emoji.id === null ? emoji.name : `:${emoji.name}:`;
}

/** The routing seams a reaction reaches. */
export type ReactionRouting = {
  /** Hands routing one reaction fact, once its reads are done. */
  onReaction: (reaction: InboundReaction) => void;
  /**
   * Whether the sender roster names this account, asked with the reactor's id before anything about
   * the reaction is read.
   */
  admits: (senderId: string) => boolean;
  /**
   * Cancels the held addition a removal names, answering whether routing held one. Synchronous, so a
   * removal is matched the moment it arrives.
   */
  withdraw: (reaction: ReactionKey) => boolean;
};

/** What the reaction handlers read besides the reaction: the routing seams and this bot's own user. */
export type ReactionListenerOptions = Pick<GatewayOptions, "channelId"> &
  ReactionRouting & {
    /** This bot's own user, and null while the connection has not identified yet. */
    selfId: () => string | null;
    /** The clock a reaction's arrival is stamped from. `Date.now` unless a test drives one. */
    now?: () => number;
    log: (message: string) => void;
  };

/**
 * The connection's handler for a reaction added and a reaction removed, one function told
 * which of the two it is.
 *
 * The message handler's two gates come first, a thread whose parent is this host's channel and
 * then this bot's own user: the receipt tracker's stage marks are this bot's reactions, and they
 * are dropped here before anything is read, so they never come back as a line. Then the sender
 * roster, asked with the reactor's id alone: an account it does not name is dropped and logged
 * before anything is read. A reaction from any other bot is dropped once its user is known. A
 * reaction from before the connection has identified cannot be told from this bot's own, and is
 * dropped too. The arrival time is stamped before any read, and the hold counts from it.
 *
 * A removal is matched to its addition with no read at all, by thread, reactor, emoji and message.
 * An addition still waiting on its reads here, and still inside its `REACTION_HOLD_MS` hold from
 * its arrival, is marked cancelled, and its fact is discarded when they finish. One routing already
 * holds is cancelled through routing's `withdraw`. Either way the removal goes no further. Past the
 * hold, or with nothing to cancel, a removal travels on behind its addition for its withdrawal
 * line, and it never fetches the message it sat on: the message is named where the library's
 * cache holds it whole, and is unreadable otherwise.
 *
 * The reactor, and the message an addition sits on, are read from the library's cache where it
 * holds them whole, and fetched only where it holds a partial. A reactor that cannot be read is
 * dropped and logged, since routing cannot class an account it cannot name, and a message that
 * cannot be read is handed on as unreadable and logged. The fetch can wait out the library's retry
 * budget, so each thread's reactions run behind a tail of their own: a thread's reactions reach
 * routing in the order Discord sent them, and a slow read holds back only the later reactions in
 * its thread and never a message, which takes no part in this tail.
 */
export function createReactionListener(
  options: ReactionListenerOptions,
): (
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  action: ReactionAction,
) => void {
  const log = options.log;
  const now = options.now ?? Date.now;
  // The tail of each thread's reactions, gone from the map once nothing waits behind it.
  const tails = new Map<string, Promise<void>>();
  // The additions still in each thread's tail, waiting on their reads, each with its arrival time
  // and marked once a removal cancels it. Gone from the map once the thread has none.
  type Pending = { key: ReactionKey; arrivedAt: number; cancelled: boolean };
  const pending = new Map<string, Pending[]>();

  function settledPending(threadId: string, entry: Pending): void {
    const waiting = (pending.get(threadId) ?? []).filter((held) => held !== entry);
    if (waiting.length === 0) pending.delete(threadId);
    else pending.set(threadId, waiting);
  }

  async function factOf(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    action: ReactionAction,
    emoji: string,
    arrivedAt: number,
    selfId: string,
  ): Promise<InboundReaction | null> {
    const threadId = reaction.message.channelId;
    let reactor: User;
    try {
      reactor = user.partial ? await user.fetch() : user;
    } catch {
      log(`gateway: a reaction in thread ${threadId} was dropped, its user could not be read`);
      return null;
    }
    if (reactor.bot) return null;
    let target: Message | null = null;
    if (!reaction.message.partial) {
      target = reaction.message;
    } else if (action === "added") {
      try {
        target = await reaction.message.fetch();
      } catch {
        log(`gateway: the message a reaction in thread ${threadId} sits on could not be read`);
      }
    }
    const member = reaction.message.guild?.members.cache.get(reactor.id) ?? null;
    return {
      threadId,
      messageId: reaction.message.id,
      senderId: reactor.id,
      author: authorName({
        id: reactor.id,
        nickname: member?.nickname ?? null,
        globalName: reactor.globalName,
        username: reactor.username,
      }),
      emoji,
      action,
      target:
        target === null
          ? null
          : {
              author: authorName({
                id: target.author.id,
                nickname: target.member?.nickname ?? null,
                globalName: target.author.globalName,
                username: target.author.username,
              }),
              at: target.createdTimestamp,
              text: target.content,
              own: target.author.id === selfId,
            },
      arrivedAt,
    };
  }

  return (reaction, user, action) => {
    const arrivedAt = now();
    const channel = reaction.message.channel;
    if (!channel.isThread() || channel.parentId !== options.channelId) return;
    const selfId = options.selfId();
    if (selfId === null || user.id === selfId) return;
    // A partial user carries its id, so the roster is asked before anything is read.
    if (!options.admits(user.id)) {
      log(`gateway: a reaction from ${user.id} was dropped, the sender roster does not name that account`);
      return;
    }
    const threadId = reaction.message.channelId;
    const emoji = emojiName(reaction.emoji);
    if (emoji === null) {
      log(`gateway: a reaction in thread ${threadId} was dropped, its emoji carries no name`);
      return;
    }
    const key: ReactionKey = { threadId, messageId: reaction.message.id, senderId: user.id, emoji };
    if (action === "removed") {
      const waiting = pending
        .get(threadId)
        ?.find(
          // Inside the addition's hold alone: a removal after it travels on behind the addition and
          // leaves as the withdrawal line, as one routing no longer holds does.
          (held) =>
            !held.cancelled &&
            arrivedAt - held.arrivedAt < REACTION_HOLD_MS &&
            held.key.senderId === key.senderId &&
            held.key.emoji === key.emoji &&
            held.key.messageId === key.messageId,
        );
      if (waiting !== undefined) {
        waiting.cancelled = true;
        return;
      }
      if (options.withdraw(key)) return;
    }
    const added = action === "added" ? { key, arrivedAt, cancelled: false } : null;
    if (added !== null) pending.set(threadId, [...(pending.get(threadId) ?? []), added]);
    const turn = (tails.get(threadId) ?? Promise.resolve())
      .then(async () => {
        try {
          // An addition cancelled before its turn is read no further.
          const fact =
            added?.cancelled === true ? null : await factOf(reaction, user, action, emoji, arrivedAt, selfId);
          if (fact !== null && added?.cancelled !== true) options.onReaction(fact);
        } finally {
          // Nothing runs between the hand-on above and this line, so a removal arriving after it
          // finds the addition in routing's hold.
          if (added !== null) settledPending(threadId, added);
        }
      })
      .catch((error: unknown) => {
        log(`gateway: routing a reaction failed: ${describe(error)}`);
      });
    tails.set(threadId, turn);
    void turn.then(() => {
      if (tails.get(threadId) === turn) tails.delete(threadId);
    });
  };
}

export function createGatewayMessageSource(options: GatewayOptions): MessageSource {
  const log = options.log ?? ((): void => {});
  // The message, reaction and user partials let a reaction on a message this connection has not
  // cached, or from a user it has not cached, still arrive, to be read by the reaction handler.
  const client = new Client({
    intents: gatewayIntents(options.voice === true),
    partials: [Partials.Message, Partials.Reaction, Partials.User],
  });

  client.on(
    Events.MessageCreate,
    createMessageListener({
      channelId: options.channelId,
      onMessage: options.onMessage,
      deleteMessage: options.deleteMessage,
      selfId: () => client.user?.id ?? null,
      log,
    }),
  );

  const reactions = options.reactions;
  if (reactions !== undefined) {
    const react = createReactionListener({
      channelId: options.channelId,
      ...reactions,
      selfId: () => client.user?.id ?? null,
      log,
    });
    client.on(Events.MessageReactionAdd, (reaction, user) => react(reaction, user, "added"));
    client.on(Events.MessageReactionRemove, (reaction, user) => react(reaction, user, "removed"));
  }

  client.on(Events.InteractionCreate, (interaction) => {
    const onInteraction = options.onInteraction;
    if (onInteraction === undefined) return;
    // Message components only: this broker builds no commands and no modals, so anything else is
    // an event it has nothing to answer with.
    if (!interaction.isMessageComponent()) return;
    // The same two gates MessageCreate applies, for the same reason: two brokers can share a
    // guild, and a press on a message in one host's channel must not reach another host's desk.
    //
    // A null channel is the one of them a working press can land on: the library resolves it from
    // its own cache, and a thread this connection has not cached yet resolves to nothing. The press
    // is dropped, so it is logged, because the alternative is an operator whose tap reports a
    // failure with no line anywhere saying why.
    if (interaction.channel === null) {
      log(`gateway: an interaction in channel ${interaction.channelId} was dropped, it is not cached`);
      return;
    }
    if (!interaction.channel.isThread()) return;
    if (interaction.channel.parentId !== options.channelId) return;

    void onInteraction({
      interactionId: interaction.id,
      token: interaction.token,
      threadId: interaction.channelId,
      // Reported rather than checked here: the allowlist over it is a routing decision like any
      // other, and it lives in one place with the one that gates inbound messages.
      senderId: interaction.user.id,
      customId: interaction.customId,
      // A button reports no values; a string select reports every option it now has chosen.
      values: interaction.isStringSelectMenu() ? interaction.values : [],
    }).catch((error: unknown) => {
      log(`gateway: routing an interaction failed: ${describe(error)}`);
    });
  });

  client.on(Events.Error, (error) => {
    log(`gateway: ${describe(error)}`);
  });

  // Looked up fresh on every call rather than latched once: `channels.cache` costs no REST call
  // either way, and a value read once at `ClientReady` can stay null for the process's life, since
  // that event fires once discord.js's own guild wait times out even while a guild is still
  // unavailable. A channel not in the cache yet, or one that is not a guild channel (only a
  // guild-scoped channel type carries `guildId`), answers null on the calls it misses and heals on
  // the first call after the cache catches up.
  const guildId = (): string | null => {
    const channel = client.channels.cache.get(options.channelId);
    const resolved = channel !== undefined && "guildId" in channel ? channel.guildId : null;
    return typeof resolved === "string" ? resolved : null;
  };

  let voice: VoiceGateway | null = null;
  if (options.voice === true) {
    const guild = () => {
      const id = guildId();
      return id === null ? null : (client.guilds.cache.get(id) ?? null);
    };
    const listeners = new Set<(change: VoiceStateChange) => void>();
    client.on(Events.VoiceStateUpdate, (before, after) => {
      if (after.guild.id !== guildId()) return;
      const change = { userId: after.id, before: before.channelId, after: after.channelId };
      for (const listener of listeners) {
        try {
          listener(change);
        } catch (error) {
          log(`gateway: a voice-state listener failed: ${describe(error)}`);
        }
      }
    });
    voice = {
      guildId,
      adapterCreator: () => guild()?.voiceAdapterCreator ?? null,
      channelOf: (userId) => voiceChannelOf(guild()?.voiceStates.cache.get(userId)),
      selfId: () => client.user?.id ?? null,
      membersOf: (channelId) =>
        [...(guild()?.voiceStates.cache.values() ?? [])]
          .filter((state) => state.channelId === channelId)
          .map((state) => state.id),
      nameOf: (userId) => {
        const member = guild()?.voiceStates.cache.get(userId)?.member ?? null;
        if (member === null) return null;
        return authorName({
          id: userId,
          nickname: member.nickname,
          globalName: member.user.globalName,
          username: member.user.username,
        });
      },
      onVoiceState: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }

  return {
    start: async () => {
      await client.login(options.token);
      log("gateway: connected, inbound messages are being read");
    },
    stop: async () => {
      await client.destroy();
    },
    guildId,
    voice,
  };
}
