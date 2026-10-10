import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { messages } from '../db/schema.js';
import type { Source } from '../sources.js';
import type { Send } from './discord.js';
import { type Batch, type PendingMessage, planBatches } from './plan.js';

/**
 * How many times Discord may refuse a message for something about it before
 * the hub stops trying. The row stays, undelivered, with the last status.
 */
export const MAX_ATTEMPTS = 5;

/** How long a source must be quiet before its burst goes out as one post. */
export const SETTLE_MS = 60_000;

/** Most rows one pass reads for one source — ten full posts; the rest wait. */
const SOURCE_LIMIT = 100;

/** Statuses that say the webhook is gone or wrong, not the message. */
const WEBHOOK_REFUSED = new Set([401, 403, 404]);

export interface DrainResult {
  sent: number;
  /** Discord asked the whole hub to wait; the rest of the pass was left. */
  limited: boolean;
}

/** What one post's outcome means for the rest of the pass. */
type Next = 'continue' | 'skip-source' | 'stop';

/**
 * One delivery pass: read what is undelivered for every source with a
 * webhook, send it in batches, record what happened.
 *
 * A 2xx marks a batch delivered. Anything that is the webhook's trouble
 * rather than the message's — no answer, a 5xx, a rate limit, a webhook that
 * is gone — counts nothing and leaves that source until the next pass; the
 * other sources carry on, and a 429 Discord marks global stops the pass. Any
 * other 4xx is about what was sent, so the batch is retried a message at a
 * time and the one Discord refuses alone is counted.
 */
export async function drain(
  db: Database,
  sources: Source[],
  send: Send,
  log: FastifyBaseLogger,
  now: Date,
): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, limited: false };
  const urls = new Map<string, string>();
  for (const source of sources) if (source.discordUrl) urls.set(source.name, source.discordUrl);
  if (urls.size === 0) return result;

  // Each source read on its own, and only sources that can be sent to. One
  // shared read, oldest first, would let a single source's backlog — no
  // webhook, or one refused for days — fill every pass and starve the rest.
  const pending: PendingMessage[] = [];
  for (const source of urls.keys()) {
    const rows = await db
      .select({
        id: messages.id,
        source: messages.source,
        title: messages.title,
        body: messages.body,
        url: messages.url,
        receivedAt: messages.receivedAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.source, source),
          isNull(messages.deliveredAt),
          lt(messages.attempts, MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(messages.receivedAt))
      .limit(SOURCE_LIMIT);
    pending.push(...rows);
  }

  const deliver = async (batch: Batch): Promise<Next> => {
    const outcome = await send(batch.url, batch.payload);
    if (outcome.ok) {
      await db
        .update(messages)
        .set({ deliveredAt: sql`now()` })
        .where(inArray(messages.id, batch.ids));
      result.sent += batch.ids.length;
      log.info({ source: batch.source, messages: batch.ids.length }, 'delivered');
      return 'continue';
    }

    // The source and the status, never the URL.
    const { status } = outcome;
    if (status === 429) {
      log.warn(
        { source: batch.source, retryAfterMs: outcome.retryAfterMs, global: outcome.global },
        'rate limited',
      );
      if (outcome.global) {
        result.limited = true;
        return 'stop';
      }
      return 'skip-source';
    }
    if (status === null || status >= 500) {
      log.warn({ source: batch.source, status }, 'discord unavailable');
      return 'skip-source';
    }
    // A webhook deleted or rotated in Discord before `.env` caught up. Its
    // messages wait for the new one instead of being given up on.
    if (WEBHOOK_REFUSED.has(status)) {
      log.error({ source: batch.source, status }, 'webhook refused');
      return 'skip-source';
    }

    // Refused for something in it. One bad message must not use up the
    // attempts of every message posted beside it, so a batch is retried a
    // message at a time and only what Discord refuses alone is counted.
    if (batch.ids.length > 1) {
      for (const [i, id] of batch.ids.entries()) {
        const embed = batch.payload.embeds[i];
        if (embed === undefined) continue;
        const next = await deliver({
          ...batch,
          ids: [id],
          payload: { ...batch.payload, embeds: [embed] },
        });
        if (next !== 'continue') return next;
      }
      return 'continue';
    }
    await db
      .update(messages)
      .set({ attempts: sql`${messages.attempts} + 1`, lastStatus: status })
      .where(inArray(messages.id, batch.ids));
    log.error({ source: batch.source, status }, 'discord refused a message');
    return 'continue';
  };

  const skipped = new Set<string>();
  for (const batch of planBatches(pending, urls, now, SETTLE_MS)) {
    if (skipped.has(batch.source)) continue;
    const next = await deliver(batch);
    if (next === 'stop') break;
    if (next === 'skip-source') skipped.add(batch.source);
  }
  return result;
}

/**
 * Runs `drain` every `intervalMs` for as long as the process lives, never two
 * passes at once. A pass that throws is logged and the next one runs on
 * schedule: nothing is lost, since a message is only marked delivered after
 * Discord took it.
 *
 * Returns what stops it, which waits for a pass in flight. Shutting down
 * mid-send without waiting would close the database before the send is
 * recorded, and the message would go out again after the restart.
 */
export function startDelivery(options: {
  db: Database;
  sources: Source[];
  send: Send;
  log: FastifyBaseLogger;
  intervalMs?: number;
}): () => Promise<void> {
  const { db, sources, send, log, intervalMs = 15_000 } = options;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight !== null) return;
    inFlight = drain(db, sources, send, log, new Date())
      .then(() => undefined)
      .catch((error: unknown) => log.error({ err: error }, 'delivery pass failed'))
      .finally(() => {
        inFlight = null;
      });
  }, intervalMs);
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
