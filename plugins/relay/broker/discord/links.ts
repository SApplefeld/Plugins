// Links into Discord built from identifiers: the jump link to a message in a thread, or to the
// thread itself.
//
// Every identifier composed into a link is checked against `SNOWFLAKE` first, since a link is a
// string interpolation into Discord syntax a hostile value could otherwise steer: a guild or thread
// that fails the check draws no link at all, and a message that fails it draws the thread's link.
import { SNOWFLAKE } from "../security/senders.ts";

/** A value checked against Discord's own identifier shape, or null when it is not one: the guard
 * every identifier here takes before it is interpolated into a link. */
export function snowflake(value: string | null): string | null {
  return value !== null && SNOWFLAKE.test(value) ? value : null;
}

/**
 * Where a link into a thread points: the message link
 * `https://discord.com/channels/<guild>/<thread>/<message>` where all three identifiers are known
 * snowflakes, the thread link `https://discord.com/channels/<guild>/<thread>` where the message is
 * missing or refused, and null where the guild or the thread is.
 */
export function jumpLink(
  guildId: string | null,
  threadId: string | null,
  messageId: string | null,
): string | null {
  const guild = snowflake(guildId);
  const thread = snowflake(threadId);
  if (guild === null || thread === null) return null;
  const message = snowflake(messageId);
  if (message === null) return `https://discord.com/channels/${guild}/${thread}`;
  return `https://discord.com/channels/${guild}/${thread}/${message}`;
}
