import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';

const secret = 'e'.repeat(64);

const config: Config = {
  DATABASE_URL: 'postgres://unused',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'fatal',
  sources: [{ name: 'engram', secret }],
};

/**
 * A database that records each insert and answers `returning()` with a new
 * row, or with nothing for a key already held — the way a conflict does.
 */
const stubDb = (held: string[] = []) => {
  const inserted: unknown[] = [];
  const db = {
    insert: () => ({
      values: (values: { key: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            inserted.push(values);
            return held.includes(values.key) ? [] : [{ id: 'message-1' }];
          },
        }),
      }),
    }),
  } as unknown as Database;
  return { db, inserted };
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const post = async (
  headers: Record<string, string>,
  payload: unknown,
  stub = stubDb(),
  logged?: unknown[],
) => {
  await app?.close();
  app = buildApp({ config, db: stub.db });
  if (logged) {
    app.addHook('onRequest', (request, _reply, done) => {
      request.log.warn = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.warn;
      done();
    });
  }
  return app.inject({
    method: 'POST',
    url: '/messages',
    headers: { 'content-type': 'application/json', ...headers },
    payload: payload as object,
  });
};

/** A raw body, for what JSON parsing would refuse before the route saw it. */
const injectRaw = async (payload: string, headers: Record<string, string>, logged: unknown[]) => {
  await app?.close();
  app = buildApp({ config, db: stubDb().db });
  app.addHook('onRequest', (request, _reply, done) => {
    request.log.warn = ((obj: unknown) => {
      logged.push(obj);
    }) as typeof request.log.warn;
    done();
  });
  return app.inject({
    method: 'POST',
    url: '/messages',
    headers: { 'content-type': 'application/json', ...headers },
    payload,
  });
};

const bearer = { authorization: `Bearer ${secret}` };
const message = {
  key: 'ready@show:tvdb:452595/s01e0004',
  title: 'Dexter: Resurrection S01E04 is ready',
  body: 'Next up.',
  url: 'https://engram.vyoh.gg/titles/5b2c',
};

describe('POST /messages', () => {
  it('accepts a message, under the source its secret names', async () => {
    const stub = stubDb();
    const response = await post(bearer, message, stub);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ duplicate: false });
    expect(stub.inserted).toEqual([{ source: 'engram', ...message }]);
  });

  it('answers a repeat of a key as a duplicate, still accepted', async () => {
    const response = await post(bearer, message, stubDb([message.key]));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ duplicate: true });
  });

  it('stores a message with neither body nor url', async () => {
    const stub = stubDb();
    await post(bearer, { key: 'k', title: 't' }, stub);
    expect(stub.inserted).toEqual([
      { source: 'engram', key: 'k', title: 't', body: null, url: null },
    ]);
  });

  it('refuses a missing or wrong secret, and never logs one', async () => {
    const logged: unknown[] = [];
    expect((await post({}, message, stubDb(), logged)).statusCode).toBe(401);
    expect(
      (await post({ authorization: 'Bearer wrong' }, message, stubDb(), logged)).statusCode,
    ).toBe(401);
    // The bare secret, with no scheme: the one header whose first word is it.
    expect((await post({ authorization: secret }, message, stubDb(), logged)).statusCode).toBe(401);
    expect(logged).toEqual([
      expect.objectContaining({ scheme: 'absent', offeredLength: 0 }),
      expect.objectContaining({ scheme: 'Bearer', offeredLength: 5 }),
      expect.objectContaining({ scheme: 'malformed', offeredLength: 0 }),
    ]);
    expect(JSON.stringify(logged)).not.toContain(secret);
  });

  it('refuses a body naming its own source, or a field it does not know', async () => {
    const stub = stubDb();
    const response = await post(bearer, { ...message, source: 'vyoh' }, stub);
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('source');
    expect(stub.inserted).toEqual([]);
  });

  it('refuses a caller without a secret before reading what it sent', async () => {
    const logged: unknown[] = [];
    const response = await injectRaw('not json at all', {}, logged);
    expect(response.statusCode).toBe(401);
    expect(logged).toEqual([expect.objectContaining({ scheme: 'absent' })]);
  });

  it('refuses a request over 16 KB', async () => {
    const response = await post(bearer, { ...message, body: 'x'.repeat(17 * 1024) });
    expect(response.statusCode).toBe(413);
  });

  it('stores a blank body as none, and a url normalised', async () => {
    const stub = stubDb();
    await post(bearer, { ...message, body: '   ', url: 'https://ex.com/a b' }, stub);
    expect(stub.inserted).toEqual([
      expect.objectContaining({ body: null, url: 'https://ex.com/a%20b' }),
    ]);
  });

  it('refuses NUL, which the database would refuse less politely', async () => {
    const response = await post(bearer, { ...message, title: 'a\0b' });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/title: title must not contain NUL/);
  });

  it('says which fields are wrong without repeating them', async () => {
    const response = await post(bearer, {
      key: 'has spaces',
      title: 'x'.repeat(257),
      url: 'ftp://somewhere',
    });
    expect(response.statusCode).toBe(400);
    const { message: why } = response.json();
    expect(why).toMatch(/key: key must not contain whitespace/);
    expect(why).toMatch(/title:/);
    expect(why).toMatch(/url:/);
    expect(why).not.toContain('x'.repeat(257));
  });
});
