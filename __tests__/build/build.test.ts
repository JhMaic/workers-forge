import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/runtime/entrypoint', () => import('../_stubs/cloudflare-workers'));
// Build's dynamic import() uses absolute file URLs which bypass the relative
// mock above; mock the bare `cloudflare:workers` specifier too so that
// re-imports of `_runtime` from the dynamically loaded fixtures resolve.
vi.mock('cloudflare:workers', () => import('../_stubs/cloudflare-workers'));

const { build } = await import('../../src/build');

const FIXTURE_ROOT = resolve(__dirname, '../fixtures/build');
const OUT_DIR = resolve(FIXTURE_ROOT, '.build');

describe('build()', () => {
  it('emits one wrangler.jsonc per discovered module', async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
    const result = await build({
      cwd: FIXTURE_ROOT,
      modules: ['*/index.ts'],
      outDir: '.build',
      prefix: 'pfx-',
    });
    expect(result.deployed.sort()).toEqual(['consumer', 'hono', 'producer']);

    const producerCfg = JSON.parse(await readFile(join(OUT_DIR, 'producer/wrangler.jsonc'), 'utf-8'));
    expect(producerCfg.name).toBe('pfx-producer');
    expect(producerCfg.vars).toEqual({ GREETING: 'hi' });

    const consumerCfg = JSON.parse(await readFile(join(OUT_DIR, 'consumer/wrangler.jsonc'), 'utf-8'));
    expect(consumerCfg.name).toBe('pfx-consumer');
    expect(consumerCfg.services).toEqual([{ binding: 'PROD', service: 'pfx-producer' }]);
    expect(consumerCfg.triggers).toEqual({ crons: ['*/10 * * * *'] });

    const honoCfg = JSON.parse(await readFile(join(OUT_DIR, 'hono/wrangler.jsonc'), 'utf-8'));
    expect(honoCfg.name).toBe('pfx-hono');
    expect(honoCfg.vars).toEqual({ GREETING: 'hi' });
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('throws when validation fails (unknown service ref)', async () => {
    const failOut = resolve(FIXTURE_ROOT, '.build-fail');
    await expect(build({
      cwd: FIXTURE_ROOT,
      modules: ['consumer/index.ts'],
      outDir: '.build-fail',
      prefix: 'pfx-',
    })).rejects.toThrow(/unknown worker/);
    await rm(failOut, { recursive: true, force: true });
  });
});
