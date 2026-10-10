/** A message waiting to be sent, as the delivery loop reads it. */
export interface PendingMessage {
  id: string;
  source: string;
  title: string;
  body: string | null;
  url: string | null;
  receivedAt: Date;
}

/** One embed, in the shape Discord's webhook API takes. */
export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  timestamp: string;
}

export interface DiscordPayload {
  embeds: DiscordEmbed[];
  /** Empty, so nothing in a title can ping anyone. */
  allowed_mentions: { parse: [] };
}

/** One post to one source's channel, and the messages it carries. */
export interface Batch {
  source: string;
  url: string;
  ids: string[];
  payload: DiscordPayload;
}

/**
 * Discord's own ceilings for one webhook post: ten embeds, and six thousand
 * characters across every embed's text.
 */
export const MAX_EMBEDS = 10;
export const MAX_EMBED_CHARS = 6000;

export function embedOf(message: PendingMessage): DiscordEmbed {
  return {
    title: message.title,
    ...(message.body === null ? {} : { description: message.body }),
    ...(message.url === null ? {} : { url: message.url }),
    timestamp: message.receivedAt.toISOString(),
  };
}

const charsOf = (embed: DiscordEmbed) => embed.title.length + (embed.description?.length ?? 0);

/**
 * What to send now: each source's pending messages, as few posts as Discord's
 * limits allow, oldest first.
 *
 * Pure: no database, no network, and the clock passed in.
 *
 * A source waits until it has been quiet for `settleMs`, so a burst — a season
 * pack lands as several imports a minute apart — goes out as one post instead
 * of trickling in as it arrives. A source that never goes quiet still sends
 * once its oldest message has waited five times that, so a steady stream is
 * late rather than lost. A source with no webhook is skipped; its messages
 * wait until one is set.
 */
export function planBatches(
  pending: PendingMessage[],
  urls: ReadonlyMap<string, string>,
  now: Date,
  settleMs: number,
  maxWaitMs = settleMs * 5,
): Batch[] {
  const bySource = new Map<string, PendingMessage[]>();
  for (const message of pending) {
    const list = bySource.get(message.source) ?? [];
    list.push(message);
    bySource.set(message.source, list);
  }

  const batches: Batch[] = [];
  for (const [source, messages] of bySource) {
    const url = urls.get(source);
    if (url === undefined) continue;
    const times = messages.map((m) => m.receivedAt.getTime());
    const quiet = now.getTime() - Math.max(...times) >= settleMs;
    const overdue = now.getTime() - Math.min(...times) >= maxWaitMs;
    if (!quiet && !overdue) continue;

    messages.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    let current: { ids: string[]; embeds: DiscordEmbed[]; chars: number } | null = null;
    const flush = () => {
      if (current === null) return;
      batches.push({
        source,
        url,
        ids: current.ids,
        payload: { embeds: current.embeds, allowed_mentions: { parse: [] } },
      });
      current = null;
    };
    for (const message of messages) {
      const embed = embedOf(message);
      const chars = charsOf(embed);
      if (
        current !== null &&
        (current.embeds.length >= MAX_EMBEDS || current.chars + chars > MAX_EMBED_CHARS)
      ) {
        flush();
      }
      current ??= { ids: [], embeds: [], chars: 0 };
      current.ids.push(message.id);
      current.embeds.push(embed);
      current.chars += chars;
    }
    flush();
  }
  return batches;
}
