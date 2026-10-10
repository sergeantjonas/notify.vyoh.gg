import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { Send, SendResult } from './discord.js';
import { drain, startDelivery } from './drain.js';
import type { PendingMessage } from './plan.js';

const now = new Date('2026-10-10T12:00:00Z');
const old = new Date(now.getTime() - 5 * 60_000);
const sources = [
  {
    name: 'engram',
    secret: 'e'.repeat(64),
    discordUrl: 'https://discord.com/api/webhooks/1/engram-token',
  },
  {
    name: 'vyoh',
    secret: 'v'.repeat(64),
    discordUrl: 'https://discord.com/api/webhooks/2/vyoh-token',
  },
];

const pending = (source: string, titles: string[]): PendingMessage[] =>
  titles.map((title) => ({ id: title, source, title, body: null, url: null, receivedAt: old }));

/**
 * Answers each source's read in turn — engram's, then vyoh's — and records
 * every update with what it set.
 */
const stubDb = (...perSource: PendingMessage[][]) => {
  const updates: Record<string, unknown>[] = [];
  let reads = 0;
  const db = {
    select: () => {
      const rows = perSource[reads] ?? [];
      reads += 1;
      return {
        from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }),
      };
    },
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          updates.push(set);
        },
      }),
    }),
  } as unknown as Database;
  return { db, updates, reads: () => reads };
};

/** A logger that keeps every line, to check none of them carries a URL. */
const recordingLog = () => {
  const lines: unknown[] = [];
  const keep = (obj: unknown) => {
    lines.push(obj);
  };
  return { log: { info: keep, warn: keep, error: keep } as unknown as FastifyBaseLogger, lines };
};

/** Answers each send in turn, and records the titles each one carried. */
const scripted = (answers: SendResult[]) => {
  const posts: string[][] = [];
  const send: Send = async (_url, payload) => {
    posts.push(payload.embeds.map((e) => e.title));
    return answers.shift() ?? { ok: true };
  };
  return { send, posts };
};

const refused = (status: number | null, global = false): SendResult => ({
  ok: false,
  status,
  retryAfterMs: null,
  global,
});

describe('drain', () => {
  it('marks a batch delivered once Discord takes it, and logs no URL', async () => {
    const { db, updates, reads } = stubDb(pending('engram', ['a', 'b']), []);
    const { send, posts } = scripted([{ ok: true }]);
    const { log, lines } = recordingLog();
    expect(await drain(db, sources, send, log, now)).toEqual({ sent: 2, limited: false });
    expect(posts).toEqual([['a', 'b']]);
    expect(updates).toEqual([expect.objectContaining({ deliveredAt: expect.anything() })]);
    expect(JSON.stringify(lines)).not.toContain('token');
    // One read per source, so neither's backlog can crowd the other out.
    expect(reads()).toBe(2);
  });

  it('reads nothing when no source has a webhook', async () => {
    const { db, reads } = stubDb(pending('engram', ['a']));
    const noWebhooks = sources.map((s) => ({ ...s, discordUrl: null }));
    await drain(db, noWebhooks, scripted([]).send, recordingLog().log, now);
    expect(reads()).toBe(0);
  });

  /** Eleven of engram's, which is two posts, and one of vyoh's. */
  const eleven = Array.from({ length: 11 }, (_, i) => `e${i}`);

  it('leaves a source for later, counting nothing, when its webhook is down or gone', async () => {
    for (const answer of [refused(503), refused(null), refused(404), refused(401)]) {
      const { db, updates } = stubDb(pending('engram', eleven), pending('vyoh', ['v']));
      const { send, posts } = scripted([answer, { ok: true }]);
      const result = await drain(db, sources, send, recordingLog().log, now);
      // Engram's second post is never tried; vyoh, behind it, still goes out.
      expect(posts).toEqual([eleven.slice(0, 10), ['v']]);
      expect(result.sent).toBe(1);
      expect(updates).toEqual([expect.objectContaining({ deliveredAt: expect.anything() })]);
    }
  });

  it("holds only the rate-limited source, unless Discord's limit is global", async () => {
    const local = scripted([refused(429), { ok: true }]);
    const db = () => stubDb(pending('engram', eleven), pending('vyoh', ['v'])).db;
    expect((await drain(db(), sources, local.send, recordingLog().log, now)).sent).toBe(1);
    expect(local.posts).toEqual([eleven.slice(0, 10), ['v']]);

    const global = scripted([refused(429, true)]);
    const result = await drain(db(), sources, global.send, recordingLog().log, now);
    expect(result).toEqual({ sent: 0, limited: true });
    expect(global.posts).toEqual([eleven.slice(0, 10)]);
  });

  it('retries a refused batch a message at a time, counting only the one refused', async () => {
    const { db, updates } = stubDb(pending('engram', ['good', 'bad']));
    const { send, posts } = scripted([refused(400), { ok: true }, refused(400)]);
    const result = await drain(db, sources, send, recordingLog().log, now);
    expect(posts).toEqual([['good', 'bad'], ['good'], ['bad']]);
    expect(result.sent).toBe(1);
    expect(updates).toEqual([
      expect.objectContaining({ deliveredAt: expect.anything() }),
      expect.objectContaining({ lastStatus: 400 }),
    ]);
  });

  it('stops a split as soon as a single send is rate-limited', async () => {
    const { db, updates } = stubDb(pending('engram', ['a', 'b']));
    const { send, posts } = scripted([refused(400), refused(429)]);
    await drain(db, sources, send, recordingLog().log, now);
    expect(posts).toEqual([['a', 'b'], ['a']]);
    expect(updates).toEqual([]);
  });
});

describe('startDelivery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops only once the pass in flight has finished', async () => {
    vi.useFakeTimers();
    let release = () => {};
    const send: Send = () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      });
    const { db, updates, reads } = stubDb(pending('engram', ['a']));
    const stop = startDelivery({ db, sources, send, log: recordingLog().log, intervalMs: 1000 });

    // A pass starts and waits on Discord; the clock is past its settle window.
    vi.setSystemTime(now);
    await vi.advanceTimersByTimeAsync(1000);
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(updates).toHaveLength(1);

    // And no pass after it: the one pass read each source once.
    await vi.advanceTimersByTimeAsync(5000);
    expect(reads()).toBe(2);
  });
});
