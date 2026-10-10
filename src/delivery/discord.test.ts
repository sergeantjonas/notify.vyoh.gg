import { describe, expect, it } from 'vitest';
import { createDiscordSender } from './discord.js';

const payload = {
  embeds: [{ title: 't', timestamp: '2026-10-10T12:00:00.000Z' }],
  allowed_mentions: { parse: [] as [] },
};
const url = 'https://discord.com/api/webhooks/1/token';

const answering = (response: Response) => (async () => response) as unknown as typeof fetch;

describe('createDiscordSender', () => {
  it('posts the payload as JSON and reports a 204 as delivered', async () => {
    let seen: { url: unknown; body: unknown } | null = null;
    const fetcher = (async (to: unknown, init: RequestInit) => {
      seen = { url: to, body: JSON.parse(String(init.body)) };
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await createDiscordSender(fetcher)(url, payload)).toEqual({ ok: true });
    expect(seen).toEqual({ url, body: payload });
  });

  it('reads how long Discord asks to be left alone after a 429', async () => {
    const limited = new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 });
    expect(await createDiscordSender(answering(limited))(url, payload)).toEqual({
      ok: false,
      status: 429,
      retryAfterMs: 1500,
      global: false,
    });
  });

  it('reports a refusal by status, and no answer as null, without throwing', async () => {
    const refused = new Response('{"message":"Invalid Form Body"}', { status: 400 });
    expect(await createDiscordSender(answering(refused))(url, payload)).toEqual({
      ok: false,
      status: 400,
      retryAfterMs: null,
      global: false,
    });
    const unreachable = (async () => {
      throw new TypeError(`fetch failed: ${url}`);
    }) as unknown as typeof fetch;
    expect(await createDiscordSender(unreachable)(url, payload)).toEqual({
      ok: false,
      status: null,
      retryAfterMs: null,
      global: false,
    });
  });
});
