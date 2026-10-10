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
      { name: 'engram', secret: engram },
      { name: 'vyoh-gg', secret: vyoh },
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

  it('refuses two sources sharing a secret, since the secret is what names one', () => {
    const { issues } = readSources({ SOURCE_ENGRAM_SECRET: engram, SOURCE_VYOH_SECRET: engram });
    expect(issues).toEqual(['sources engram and vyoh share a secret']);
  });
});

describe('sourceFor', () => {
  const sources = [
    { name: 'engram', secret: engram },
    { name: 'vyoh', secret: vyoh },
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
