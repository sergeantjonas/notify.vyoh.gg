import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Beside Engram's 2012 in development; on the box, whatever port the
  // deploy publishes it on.
  PORT: z.coerce.number().int().positive().default(2013),
  // Loopback by default: this runs on a public VPS behind a TLS proxy, and
  // binding every interface would expose it directly.
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof schema>;

function orThrow<T>(result: z.ZodSafeParseResult<T>): T {
  if (result.success) return result.data;
  // The issues only, never the values: secrets live in this environment.
  const issues = result.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid configuration:\n${issues}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return orThrow(schema.safeParse(env));
}

/** Just the database, for `db:migrate`, which reads nothing else. */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return orThrow(schema.pick({ DATABASE_URL: true }).safeParse(env)).DATABASE_URL;
}
