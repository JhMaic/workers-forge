import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverModuleFiles } from '../../src/build/internal/discover';

const FIXTURE_ROOT = resolve(__dirname, '../fixtures/discover');

describe('discoverModuleFiles', () => {
  it('returns matching files using default pattern', async () => {
    const files = await discoverModuleFiles({
      cwd: FIXTURE_ROOT,
      modules: ['*/index.ts', '!_*/**', '!__tests__/**'],
    });
    const rel = files.map(f => f.replace(FIXTURE_ROOT, ''));
    expect(rel).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/[/\\]a[/\\]index\.ts$/),
        expect.stringMatching(/[/\\]b[/\\]index\.ts$/),
      ]),
    );
    expect(rel.some(f => f.includes('_skip'))).toBe(false);
    expect(rel.some(f => f.includes('__tests__'))).toBe(false);
  });

  it('returns absolute paths', async () => {
    const files = await discoverModuleFiles({
      cwd: FIXTURE_ROOT,
      modules: ['a/index.ts'],
    });
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^(\/|[A-Z]:)/);
  });

  it('drops .d.ts files even when a broad pattern would match them', async () => {
    const files = await discoverModuleFiles({
      cwd: FIXTURE_ROOT,
      modules: ['c/*.ts'],
    });
    const rel = files.map(f => f.replace(FIXTURE_ROOT, ''));
    expect(rel).toEqual([expect.stringMatching(/[/\\]c[/\\]index\.ts$/)]);
    expect(rel.some(f => f.endsWith('.d.ts'))).toBe(false);
  });
});
