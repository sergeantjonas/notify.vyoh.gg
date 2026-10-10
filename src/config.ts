import { z } from 'zod';
import { readSources, type Source } from './sources.js';

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

export type Config = z.infer<typeof schema> & {
  /** Who may post. Empty is allowed: the hub boots and refuses every post. */
  sources: Source[];
};

function fail(issues: string[]): never {
  // The issues only, never the values: secrets live in this environment.
  throw new Error(`Invalid configuration:\n${issues.map((issue) => `  ${issue}`).join('\n')}`);
}

function orThrow<T>(result: z.ZodSafeParseResult<T>): T {
  if (result.success) return result.data;
  fail(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  const { sources, issues } = readSources(env);
  // Both lists at once, so one boot names every problem rather than the first.
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  if (!parsed.success || issues.length > 0) fail([...schemaIssues, ...issues]);
  return { ...parsed.data, sources };
}

/** Just the database, for `db:migrate`, which reads nothing else. */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return orThrow(schema.pick({ DATABASE_URL: true }).safeParse(env)).DATABASE_URL;
}
