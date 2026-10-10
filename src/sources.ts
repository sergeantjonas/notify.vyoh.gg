import { timingSafeEqual } from 'node:crypto';

/** A project allowed to post, and the secret that says it is that project. */
export interface Source {
  /** Lowercase, from the variable's name: `SOURCE_ENGRAM_SECRET` is `engram`. */
  name: string;
  secret: string;
  /**
   * The Discord webhook this source's messages go to, from
   * `SOURCE_<NAME>_DISCORD_URL`. Null holds them, accepted and undelivered,
   * until one is set. A credential: whoever holds it can post to the channel.
   */
  discordUrl: string | null;
}

const NAME = '([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)';
const SECRET_KEY = new RegExp(`^SOURCE_${NAME}_SECRET$`);
const DISCORD_KEY = new RegExp(`^SOURCE_${NAME}_DISCORD_URL$`);

const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
]);

/**
 * A Discord webhook and nothing else, so a typo cannot post alerts elsewhere.
 * With or without an API version in the path, as Discord's own copy button
 * and its documentation give it.
 */
function isDiscordWebhook(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    DISCORD_HOSTS.has(url.hostname) &&
    /^\/api\/(?:v\d+\/)?webhooks\//.test(url.pathname)
  );
}

/** What `openssl rand -hex 32` produces is 64; this refuses anything guessable. */
const MIN_SECRET_LENGTH = 32;

/**
 * Every source the environment names, one `SOURCE_<NAME>_SECRET` each.
 *
 * Variables rather than one list, so a source is added or rotated by editing
 * one line of `.env`. The secret alone names the source — a post never says
 * which project it is from — so two sources sharing a secret would make one
 * indistinguishable from the other, and that is refused at boot.
 */
export function readSources(env: NodeJS.ProcessEnv): { sources: Source[]; issues: string[] } {
  const sources: Source[] = [];
  const issues: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    const match = SECRET_KEY.exec(key);
    if (!match?.[1]) continue;
    // Empty counts as unset: it is what Compose passes for a variable it was
    // told to default.
    if (value === undefined || value === '') continue;
    // A secret travels in a header, which Node decodes as latin1, so anything
    // beyond printable ASCII could never match; and one with a space would
    // put its first word where the refusal log expects a scheme.
    if (!/^[\x21-\x7e]+$/.test(value)) {
      issues.push(`${key}: must be printable ASCII without spaces`);
      continue;
    }
    if (value.length < MIN_SECRET_LENGTH) {
      issues.push(`${key}: must be at least ${MIN_SECRET_LENGTH} characters`);
      continue;
    }

    const urlKey = `SOURCE_${match[1]}_DISCORD_URL`;
    const url = env[urlKey];
    let discordUrl: string | null = null;
    if (url !== undefined && url !== '') {
      if (isDiscordWebhook(url)) discordUrl = url;
      else issues.push(`${urlKey}: must be a Discord webhook URL`);
    }
    sources.push({ name: match[1].toLowerCase().replaceAll('_', '-'), secret: value, discordUrl });
  }

  // A webhook with no secret beside it is a misspelt name, and its messages
  // would never arrive to be sent.
  for (const [key, value] of Object.entries(env)) {
    const match = DISCORD_KEY.exec(key);
    if (!match?.[1] || value === undefined || value === '') continue;
    const secret = env[`SOURCE_${match[1]}_SECRET`];
    if (secret === undefined || secret === '') {
      issues.push(`${key}: has no SOURCE_${match[1]}_SECRET beside it`);
    }
  }

  const seen = new Map<string, string>();
  for (const source of sources) {
    const other = seen.get(source.secret);
    if (other !== undefined) issues.push(`sources ${other} and ${source.name} share a secret`);
    seen.set(source.secret, source.name);
  }

  sources.sort((a, b) => a.name.localeCompare(b.name));
  return { sources, issues };
}

/**
 * The source a bearer token belongs to, or null.
 *
 * Every secret is compared, in constant time and length-guarded, because
 * `timingSafeEqual` throws on a length mismatch rather than returning false.
 * Stopping at the first match would let timing say how far down the list a
 * guess got.
 */
export function sourceFor(sources: Source[], offered: string | undefined): Source | null {
  if (offered === undefined) return null;
  const given = Buffer.from(offered, 'utf8');
  let found: Source | null = null;
  for (const source of sources) {
    const want = Buffer.from(source.secret, 'utf8');
    if (given.length === want.length && timingSafeEqual(given, want)) found = source;
  }
  return found;
}
