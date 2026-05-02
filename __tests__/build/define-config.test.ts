import type { KitConfig } from '../../src/build/config';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/build/config';

describe('defineConfig', () => {
  it('returns its input unchanged (identity)', () => {
    const cfg: KitConfig = { prefix: 'x-', modules: ['src/**/index.ts'] };
    expect(defineConfig(cfg)).toBe(cfg);
  });

  it('infers a KitConfig from a literal', () => {
    const cfg = defineConfig({ prefix: 'y-' });
    expect(cfg.prefix).toBe('y-');
  });
});
