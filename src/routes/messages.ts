import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { messages } from '../db/schema.js';
import { type Source, sourceFor } from '../sources.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The project a post is from, set once its secret has been checked. */
    source: Source | null;
  }
}

// Postgres refuses NUL in text, which would turn a bad request into a 500.
const noNul = (value: string) => !value.includes('\0');

/**
 * What a sender may post. Strict, so a misspelt field is refused rather than
 * quietly dropped, and with no `source`: the secret already says who posted,
 * and a field saying otherwise is what a leaked secret would forge.
 *
 * The lengths are Discord's: an embed title takes 256 characters, a message
 * 2000.
 */
const messageBody = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^\S+$/, 'key must not contain whitespace')
    .refine(noNul, 'key must not contain NUL'),
  title: z.string().trim().min(1).max(256).refine(noNul, 'title must not contain NUL'),
  body: z
    .string()
    .trim()
    .max(2000)
    .refine(noNul, 'body must not contain NUL')
    // A body of nothing but whitespace is no body.
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  // http as well, for a sender running on localhost in development. Normalised,
  // so a space reaches Discord as `%20` rather than as a URL it refuses.
  url: z
    .url({ protocol: /^https?$/, normalize: true })
    .max(2048)
    .optional(),
});

/** Far above any real message, far below anything worth parsing. */
const BODY_LIMIT = 16 * 1024;

/**
 * How the refusal log names the scheme. Only a word that looks like one: a
 * header that is the bare secret has no space, and its first word would be
 * the secret itself.
 */
function schemeOf(header: string | undefined): string {
  if (header === undefined) return 'absent';
  const word = header.split(' ')[0];
  return word !== undefined && header.includes(' ') && /^[A-Za-z]{1,16}$/.test(word)
    ? word
    : 'malformed';
}

export function registerMessageRoutes(app: FastifyInstance, config: Config, db: Database): void {
  app.decorateRequest('source', null);

  app.post(
    '/messages',
    {
      bodyLimit: BODY_LIMIT,
      // Before the body is read, as Engram's ingest route does, so a caller
      // without a secret is refused as that whatever it sent, and never makes
      // this process parse anything.
      onRequest: async (request, reply) => {
        const header = request.headers.authorization;
        const offered = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
        const source = sourceFor(config.sources, offered);
        if (source === null) {
          // Lengths, never values, as Engram's webhooks log a rejection:
          // enough to tell a missing header from a wrong secret.
          request.log.warn(
            {
              scheme: schemeOf(header),
              offeredLength: offered?.length ?? 0,
              sources: config.sources.length,
            },
            'message refused',
          );
          return reply.code(401).send({ error: 'unauthorized' });
        }
        request.source = source;
      },
    },
    async (request, reply) => {
      const source = request.source;
      // Unreachable past the hook above, and cheaper to satisfy than to explain.
      if (source === null) return reply.code(401).send({ error: 'unauthorized' });

      const parsed = messageBody.safeParse(request.body);
      if (!parsed.success) {
        // Paths and rules, which say what to fix without repeating what was sent.
        const message = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
          .join('; ');
        return reply.code(400).send({ error: 'bad_request', message });
      }
      const { key, title, body, url } = parsed.data;

      const written = await db
        .insert(messages)
        .values({ source: source.name, key, title, body: body ?? null, url: url ?? null })
        // Nothing, not an update: the first post of a key is the one that
        // counts, and a repeat has nothing to add to it.
        .onConflictDoNothing()
        .returning({ id: messages.id });
      const duplicate = written.length === 0;

      request.log.info({ source: source.name, key, duplicate }, 'message accepted');
      // 202 either way: the sender's only question is whether the hub has it.
      return reply.code(202).send({ duplicate });
    },
  );
}
