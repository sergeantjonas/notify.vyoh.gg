import type { DiscordPayload } from './plan.js';

export type SendResult =
  | { ok: true }
  | {
      ok: false;
      /** Null when Discord was never reached: a timeout, DNS, a refused connection. */
      status: number | null;
      /** How long Discord asked to be left alone, after a 429. */
      retryAfterMs: number | null;
      /** A 429 for the whole application rather than this one webhook. */
      global: boolean;
    };

export type Send = (url: string, payload: DiscordPayload) => Promise<SendResult>;

/**
 * Posts to a Discord webhook and says how it went, never throwing: every
 * outcome is one the delivery loop has a rule for.
 *
 * Nothing here logs or returns the URL. It is a credential, and an error that
 * carried it into a log would hand the channel to whoever reads the log.
 */
export function createDiscordSender(fetcher: typeof fetch = fetch, timeoutMs = 10_000): Send {
  return async (url, payload) => {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, status: null, retryAfterMs: null, global: false };
    }
    if (response.ok) return { ok: true };

    if (response.status === 429) {
      // Discord says how long in the body, in seconds, and in a header too,
      // and whether the limit is this webhook's or the whole application's.
      const body = (await response.json().catch(() => null)) as {
        retry_after?: unknown;
        global?: unknown;
      } | null;
      const seconds =
        typeof body?.retry_after === 'number'
          ? body.retry_after
          : Number(response.headers.get('retry-after'));
      return {
        ok: false,
        status: 429,
        retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null,
        global: body?.global === true,
      };
    }
    // Unread, so let go of the connection rather than leave it holding a body.
    await response.body?.cancel().catch(() => {});
    return { ok: false, status: response.status, retryAfterMs: null, global: false };
  };
}
