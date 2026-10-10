import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('reads the sources beside the rest', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      SOURCE_ENGRAM_SECRET: 'e'.repeat(64),
    });
    expect(config.sources).toEqual([{ name: 'engram', secret: 'e'.repeat(64) }]);
    expect(config.PORT).toBe(2013);
  });

  it('names every problem in one boot, and none of the values', () => {
    let thrown: unknown;
    try {
      loadConfig({ SOURCE_ENGRAM_SECRET: 'short' });
    } catch (error) {
      thrown = error;
    }
    const message = thrown instanceof Error ? thrown.message : '';
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('SOURCE_ENGRAM_SECRET');
    expect(message).not.toContain('short');
  });
});
