import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * One thing a project said was worth telling the owner, as it was posted.
 *
 * Unique on `(source, key)`, which is the whole of the hub's promise: a sender
 * retries freely and a scheduled check re-sends every run, and the second post
 * of the same thing is a conflict rather than a second message.
 */
export const messages = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The project, named by the secret it posted with rather than by the body. */
    source: text('source').notNull(),
    /** The sender's own name for the thing, shaped by the sender. */
    key: text('key').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Where the alert can be acted on, inside the project that sent it. */
    url: text('url'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null until Discord has accepted it, which is what "did it tell me?" reads. */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /**
     * Sends Discord refused for something about the message itself. An outage
     * or a rate limit is not counted, so a long one cannot use them up.
     */
    attempts: integer('attempts').notNull().default(0),
    /** The status of the last send Discord refused, to say why one is stuck. */
    lastStatus: integer('last_status'),
  },
  (t) => [
    unique('message_source_key').on(t.source, t.key),
    // What the delivery loop asks for on every pass: the few rows not yet sent.
    index('message_undelivered_idx').on(t.receivedAt).where(sql`${t.deliveredAt} is null`),
  ],
);
