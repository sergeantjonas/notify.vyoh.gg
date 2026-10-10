import { describe, expect, it } from 'vitest';
import { readSources, sourceFor } from './sources.js';

const engram = 'e'.repeat(64);
const vyoh = 'v'.repeat(64);

describe('readSources', () => {
  it('names each source after its variable, ignoring everything else', () => {
    const { sources, issues } = readSources({
      SOURCE_ENGRAM_SECRET: engram,
      SOURCE_VYOH_GG_SECRET: vyoh,
      SOURCE_ENGRAM_DISCORD_URL: 'https://discord.com/api/webhooks/1/x',
      DATABASE_URL: 'postgres://x',
    });
    expect(issues).toEqual([]);
    expect(sources).toEqual([
      { name: 'engram', secret: engram, discordUrl: 'https://discord.com/api/webhooks/1/x' },
      { name: 'vyoh-gg', secret: vyoh, discordUrl: null },
    ]);
  });

  it('treats an empty secret as unset and refuses a short one by name', () => {
    const { sources, issues } = readSources({
      SOURCE_ENGRAM_SECRET: '',
      SOURCE_VYOH_SECRET: 'short',
    });
    expect(sources).toEqual([]);
    expect(issues).toEqual(['SOURCE_VYOH_SECRET: must be at least 32 characters']);
    expect(issues.join()).not.toContain('short');
  });

  it('refuses a secret a header could not carry intact', () => {
    const spaced = `correct horse battery staple ${'x'.repeat(32)}`;
    const { sources, issues } = readSources({ SOURCE_ENGRAM_SECRET: spaced });
    expect(sources).toEqual([]);
    expect(issues).toEqual(['SOURCE_ENGRAM_SECRET: must be printable ASCII without spaces']);
  });

  it('refuses a webhook URL that is not Discord, and one with no secret beside it', () => {
    const { issues } = readSources({
      SOURCE_ENGRAM_SECRET: engram,
      SOURCE_ENGRAM_DISCORD_URL: 'https://example.com/api/webhooks/1/x',
      SOURCE_ENGRAN_DISCORD_URL: 'https://discord.com/api/webhooks/2/y',
    });
    expect(issues).toEqual([
      'SOURCE_ENGRAM_DISCORD_URL: must be a Discord webhook URL',
      'SOURCE_ENGRAN_DISCORD_URL: has no SOURCE_ENGRAN_SECRET beside it',
    ]);
    expect(issues.join()).not.toContain('webhooks/2/y');
  });

  it('takes a webhook with an API version in its path, or on canary', () => {
    const { sources, issues } = readSources({
      SOURCE_ENGRAM_SECRET: engram,
      SOURCE_ENGRAM_DISCORD_URL: 'https://canary.discord.com/api/v10/webhooks/1/x',
    });
    expect(issues).toEqual([]);
    expect(sources[0]?.discordUrl).toBe('https://canary.discord.com/api/v10/webhooks/1/x');
  });

  it('refuses two sources sharing a secret, since the secret is what names one', () => {
    const { issues } = readSources({ SOURCE_ENGRAM_SECRET: engram, SOURCE_VYOH_SECRET: engram });
    expect(issues).toEqual(['sources engram and vyoh share a secret']);
  });
});

describe('sourceFor', () => {
  const sources = [
    { name: 'engram', secret: engram, discordUrl: null },
    { name: 'vyoh', secret: vyoh, discordUrl: null },
  ];

  it('finds the source whose secret was offered', () => {
    expect(sourceFor(sources, vyoh)?.name).toBe('vyoh');
  });

  it('finds none for a wrong, short, or missing secret', () => {
    expect(sourceFor(sources, 'x'.repeat(64))).toBeNull();
    expect(sourceFor(sources, 'short')).toBeNull();
    expect(sourceFor(sources, undefined)).toBeNull();
  });
});
