import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/runtime/entrypoint', () => import('../_stubs/cloudflare-workers'));
vi.mock('cloudflare:workers', () => import('../_stubs/cloudflare-workers'));

const { build } = await import('../../src/build');

const FIXTURE_ROOT = resolve(__dirname, '../fixtures/build');

describe('build() with envs', () => {
  it('applies suffix and overlays envFile vars onto declared keys', async () => {
    const outDir = '.build-env';
    const envFileAbs = resolve(FIXTURE_ROOT, '.env.test');
    await writeFile(envFileAbs, 'GREETING=howdy\nUNUSED=ignored\n', 'utf8');
    try {
      await build({
        cwd: FIXTURE_ROOT,
        modules: ['*/index.ts'],
        outDir,
        prefix: 'pfx-',
        envs: [{ name: 'test', envFile: '.env.test', suffix: '-tst' }],
        envName: 'test',
      });

      const producerCfg = JSON.parse(
        await readFile(join(FIXTURE_ROOT, outDir, 'producer/wrangler.jsonc'), 'utf-8'),
      );
      expect(producerCfg.name).toBe('pfx-producer-tst');
      expect(producerCfg.vars).toEqual({ GREETING: 'howdy' });

      const consumerCfg = JSON.parse(
        await readFile(join(FIXTURE_ROOT, outDir, 'consumer/wrangler.jsonc'), 'utf-8'),
      );
      expect(consumerCfg.name).toBe('pfx-consumer-tst');
      expect(consumerCfg.services).toEqual([{ binding: 'PROD', service: 'pfx-producer-tst' }]);
    }
    finally {
      await rm(envFileAbs, { force: true });
      await rm(resolve(FIXTURE_ROOT, outDir), { recursive: true, force: true });
    }
  });

  it('throws when --env name is not in envs', async () => {
    await expect(build({
      cwd: FIXTURE_ROOT,
      modules: ['*/index.ts'],
      outDir: '.build-env-bad',
      prefix: 'pfx-',
      envs: [{ name: 'a', envFile: '.env.a', suffix: '-a' }],
      envName: 'b',
    })).rejects.toThrow(/Unknown env "b"/);
    await rm(resolve(FIXTURE_ROOT, '.build-env-bad'), { recursive: true, force: true });
  });

  it('throws when envName provided but envs is missing', async () => {
    await expect(build({
      cwd: FIXTURE_ROOT,
      modules: ['*/index.ts'],
      outDir: '.build-env-no-envs',
      prefix: 'pfx-',
      envName: 'whatever',
    })).rejects.toThrow(/no `envs` are configured/);
    await rm(resolve(FIXTURE_ROOT, '.build-env-no-envs'), { recursive: true, force: true });
  });

  it('throws when envFile is missing on disk', async () => {
    await expect(build({
      cwd: FIXTURE_ROOT,
      modules: ['*/index.ts'],
      outDir: '.build-env-missing-file',
      prefix: 'pfx-',
      envs: [{ name: 'gone', envFile: '.env.does-not-exist', suffix: '-g' }],
      envName: 'gone',
    })).rejects.toThrow(/Failed to read envFile/);
    await rm(resolve(FIXTURE_ROOT, '.build-env-missing-file'), { recursive: true, force: true });
  });

  it('rejects invalid envs config (duplicate names, bad suffix)', async () => {
    await expect(build({
      cwd: FIXTURE_ROOT,
      modules: ['*/index.ts'],
      outDir: '.build-env-bad-config',
      prefix: 'pfx-',
      envs: [
        { name: 'a', envFile: 'x', suffix: '-ok' },
        { name: 'a', envFile: 'y', suffix: 'BAD!!' },
      ],
    })).rejects.toThrow(/Invalid envs configuration/);
  });

  it('rejects when suffixed name exceeds worker name max length', async () => {
    const envFileAbs = resolve(FIXTURE_ROOT, '.env.long');
    await writeFile(envFileAbs, '', 'utf8');
    // prefix(4) + name(8) = 12; suffix '-' + 51 'a's = 52; total 64 > 63.
    const longSuffix = `-${'a'.repeat(51)}`;
    try {
      await expect(build({
        cwd: FIXTURE_ROOT,
        modules: ['*/index.ts'],
        outDir: '.build-env-too-long',
        prefix: 'pfx-',
        envs: [{ name: 'l', envFile: '.env.long', suffix: longSuffix }],
        envName: 'l',
      })).rejects.toThrow(/env-suffixed worker name .* exceeds limit 63/);
    }
    finally {
      await rm(envFileAbs, { force: true });
      await rm(resolve(FIXTURE_ROOT, '.build-env-too-long'), { recursive: true, force: true });
    }
  });

  it('empty suffix produces unsuffixed worker names', async () => {
    const outDir = '.build-env-empty-suffix';
    const envFileAbs = resolve(FIXTURE_ROOT, '.env.empty-suffix');
    await writeFile(envFileAbs, 'GREETING=fallback\n', 'utf8');
    try {
      await build({
        cwd: FIXTURE_ROOT,
        modules: ['*/index.ts'],
        outDir,
        prefix: 'pfx-',
        envs: [{ name: 'local', envFile: '.env.empty-suffix', suffix: '' }],
        envName: 'local',
      });
      const producerCfg = JSON.parse(
        await readFile(join(FIXTURE_ROOT, outDir, 'producer/wrangler.jsonc'), 'utf-8'),
      );
      expect(producerCfg.name).toBe('pfx-producer');
      expect(producerCfg.vars).toEqual({ GREETING: 'fallback' });
    }
    finally {
      await rm(envFileAbs, { force: true });
      await rm(resolve(FIXTURE_ROOT, outDir), { recursive: true, force: true });
    }
  });

  it('rejects suffix missing from envs entry', async () => {
    await expect(build({
      cwd: FIXTURE_ROOT,
      modules: ['*/index.ts'],
      outDir: '.build-env-no-suffix-field',
      prefix: 'pfx-',
      envs: [{ name: 'x', envFile: 'f' } as any],
    })).rejects.toThrow(/Invalid envs configuration/);
    await rm(resolve(FIXTURE_ROOT, '.build-env-no-suffix-field'), { recursive: true, force: true });
  });

  it('injects CF_CONFIG_* vars from envFile into process.env before module import', async () => {
    const cfConfigRoot = resolve(__dirname, '../fixtures/build-cf-config');
    const outDir = '.build-cf-config';
    const envFileAbs = resolve(cfConfigRoot, '.env.cfconfig');
    await writeFile(envFileAbs, 'CF_CONFIG_D1_ID=test-db-id-123\n', 'utf8');
    try {
      await build({
        cwd: cfConfigRoot,
        modules: ['*/index.ts'],
        outDir,
        prefix: 'pfx-',
        envs: [{ name: 'test', envFile: '.env.cfconfig', suffix: '' }],
        envName: 'test',
      });
      const cfg = JSON.parse(
        await readFile(join(cfConfigRoot, outDir, 'dbworker/wrangler.jsonc'), 'utf-8'),
      );
      expect(cfg.d1_databases).toEqual([{ binding: 'DB', database_id: 'test-db-id-123' }]);
    }
    finally {
      await rm(envFileAbs, { force: true });
      await rm(resolve(cfConfigRoot, outDir), { recursive: true, force: true });
    }
  });

  it('without envName behaves exactly like before (no suffix, no overlay)', async () => {
    const outDir = '.build-env-noflag';
    try {
      await build({
        cwd: FIXTURE_ROOT,
        modules: ['*/index.ts'],
        outDir,
        prefix: 'pfx-',
        envs: [{ name: 'test', envFile: '.env.unused', suffix: '-tst' }],
      });
      const producerCfg = JSON.parse(
        await readFile(join(FIXTURE_ROOT, outDir, 'producer/wrangler.jsonc'), 'utf-8'),
      );
      expect(producerCfg.name).toBe('pfx-producer');
      expect(producerCfg.vars).toEqual({ GREETING: 'hi' });
    }
    finally {
      await rm(resolve(FIXTURE_ROOT, outDir), { recursive: true, force: true });
    }
  });
});

describe('build() envs singleton injection', () => {
  const ENVS_OBJECT_ROOT = resolve(__dirname, '../fixtures/build-envs-object');

  it('injects envs.suffix and envs.prefix into worker module config', async () => {
    const outDir = '.build-envs-obj-suffix';
    const envFileAbs = resolve(ENVS_OBJECT_ROOT, '.env.envs-suffix');
    await writeFile(envFileAbs, '', 'utf8');
    try {
      await build({
        cwd: ENVS_OBJECT_ROOT,
        modules: ['*/index.ts'],
        outDir,
        prefix: 'pfx-',
        envs: [{ name: 'staging', envFile: '.env.envs-suffix', suffix: '-stg' }],
        envName: 'staging',
      });
      const cfg = JSON.parse(
        await readFile(join(ENVS_OBJECT_ROOT, outDir, 'worker/wrangler.jsonc'), 'utf-8'),
      );
      expect(cfg.d1_databases).toEqual([
        { binding: 'DB', database_id: 'placeholder', database_name: 'mydb-stg' },
      ]);
    }
    finally {
      await rm(envFileAbs, { force: true });
      await rm(resolve(ENVS_OBJECT_ROOT, outDir), { recursive: true, force: true });
    }
  });

  it('envs.suffix defaults to empty string when no env is active', async () => {
    const { envs } = await import('../../src/runtime/envs');
    const outDir = '.build-envs-obj-noenv';
    try {
      await build({
        cwd: ENVS_OBJECT_ROOT,
        modules: ['*/index.ts'],
        outDir,
        prefix: 'pfx-',
      });
      // envs singleton is reset to defaults by build() when no envName is passed
      expect(envs.suffix).toBe('');
      expect(envs.prefix).toBe('pfx-');
    }
    finally {
      await rm(resolve(ENVS_OBJECT_ROOT, outDir), { recursive: true, force: true });
    }
  });
});
