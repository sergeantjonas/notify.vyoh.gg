import { describe, expect, it } from 'vitest';
import { MAX_EMBED_CHARS, MAX_EMBEDS, type PendingMessage, planBatches } from './plan.js';

const now = new Date('2026-10-10T12:00:00Z');
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

const msg = (id: string, source: string, at: Date, over: Partial<PendingMessage> = {}) =>
  ({
    id,
    source,
    title: `Title ${id}`,
    body: null,
    url: null,
    receivedAt: at,
    ...over,
  }) satisfies PendingMessage;

const urls = new Map([
  ['engram', 'https://discord.com/api/webhooks/1/engram'],
  ['vyoh', 'https://discord.com/api/webhooks/2/vyoh'],
]);

describe('planBatches', () => {
  it('sends a quiet source as one post, oldest first, to its own channel', () => {
    const batches = planBatches(
      [msg('b', 'engram', minutesAgo(3)), msg('a', 'engram', minutesAgo(5))],
      urls,
      now,
      60_000,
    );
    expect(batches).toEqual([
      {
        source: 'engram',
        url: 'https://discord.com/api/webhooks/1/engram',
        ids: ['a', 'b'],
        payload: {
          embeds: [
            { title: 'Title a', timestamp: minutesAgo(5).toISOString() },
            { title: 'Title b', timestamp: minutesAgo(3).toISOString() },
          ],
          allowed_mentions: { parse: [] },
        },
      },
    ]);
  });

  it('holds a source whose burst is still arriving, and not the others', () => {
    const batches = planBatches(
      [
        msg('a', 'engram', minutesAgo(3)),
        msg('b', 'engram', minutesAgo(0.5)),
        msg('c', 'vyoh', minutesAgo(2)),
      ],
      urls,
      now,
      60_000,
    );
    expect(batches.map((b) => b.source)).toEqual(['vyoh']);
  });

  it('sends a source that never goes quiet once its oldest has waited five windows', () => {
    const steady = [msg('a', 'engram', minutesAgo(5)), msg('b', 'engram', minutesAgo(0.2))];
    expect(planBatches(steady, urls, now, 60_000).map((b) => b.ids)).toEqual([['a', 'b']]);
    const younger = [msg('a', 'engram', minutesAgo(4)), msg('b', 'engram', minutesAgo(0.2))];
    expect(planBatches(younger, urls, now, 60_000)).toEqual([]);
  });

  it('skips a source with no webhook', () => {
    expect(planBatches([msg('a', 'other', minutesAgo(5))], urls, now, 60_000)).toEqual([]);
  });

  it('carries body and url into the embed when there are some', () => {
    const [batch] = planBatches(
      [msg('a', 'engram', minutesAgo(5), { body: 'Next up.', url: 'https://engram.vyoh.gg/t/1' })],
      urls,
      now,
      60_000,
    );
    expect(batch?.payload.embeds[0]).toMatchObject({
      description: 'Next up.',
      url: 'https://engram.vyoh.gg/t/1',
    });
  });

  it("splits a burst at Discord's ten embeds and its six thousand characters", () => {
    const many = Array.from({ length: MAX_EMBEDS + 2 }, (_, i) =>
      msg(`m${i}`, 'engram', minutesAgo(10 - i * 0.1)),
    );
    expect(planBatches(many, urls, now, 60_000).map((b) => b.ids.length)).toEqual([10, 2]);

    const long = 'x'.repeat(2000);
    const heavy = [0, 1, 2].map((i) =>
      msg(`h${i}`, 'engram', minutesAgo(10 - i), { body: long, title: 't'.repeat(256) }),
    );
    const batches = planBatches(heavy, urls, now, 60_000);
    expect(batches.map((b) => b.ids.length)).toEqual([2, 1]);
    for (const batch of batches) {
      const chars = batch.payload.embeds.reduce(
        (sum, e) => sum + e.title.length + (e.description?.length ?? 0),
        0,
      );
      expect(chars).toBeLessThanOrEqual(MAX_EMBED_CHARS);
    }
  });
});
