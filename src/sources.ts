import { timingSafeEqual } from 'node:crypto';

/** A project allowed to post, and the secret that says it is that project. */
export interface Source {
  /** Lowercase, from the variable's name: `SOURCE_ENGRAM_SECRET` is `engram`. */
  name: string;
  secret: string;
}

const SECRET_KEY = /^SOURCE_([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)_SECRET$/;

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
    sources.push({ name: match[1].toLowerCase().replaceAll('_', '-'), secret: value });
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
