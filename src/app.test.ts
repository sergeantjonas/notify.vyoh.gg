import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import type { Database } from './db/client.js';

const config: Config = {
  DATABASE_URL: 'postgres://unused',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'fatal',
};

/** A database that answers, or one that has gone away. */
const stubDb = (reachable: boolean) =>
  ({
    execute: async () => {
      if (!reachable) throw new Error('connection refused');
      return [];
    },
  }) as unknown as Database;

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health and readiness', () => {
  it('answers health without asking the database', async () => {
    app = buildApp({ config, db: stubDb(false) });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('is ready only while the database answers', async () => {
    app = buildApp({ config, db: stubDb(true) });
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    await app.close();

    app = buildApp({ config, db: stubDb(false) });
    const down = await app.inject({ method: 'GET', url: '/ready' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toEqual({ status: 'degraded', database: 'unreachable' });
  });
});
