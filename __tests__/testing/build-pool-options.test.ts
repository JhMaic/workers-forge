import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPoolOptions } from '../../src/testing/build-pool-options';

async function writeWranglerConfig(dir: string, cfg: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'wrangler.jsonc'), `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8');
}

describe('buildPoolOptions', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'wf-pool-opts-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('returns wrangler.configPath pointing at the worker under test', async () => {
    await writeWranglerConfig(join(outDir, 'gateway'), {
      name: 'pfx-gateway',
      main: '../../src/modules/gateway/index.ts',
      compatibility_date: '2026-04-08',
    });

    const opts = await buildPoolOptions({ outDir, worker: 'gateway' });

    expect(opts.wrangler.configPath).toBe(resolve(outDir, 'gateway', 'wrangler.jsonc'));
    expect(opts.miniflare.workers ?? []).toEqual([]);
    expect(opts.miniflare.durableObjects).toBeUndefined();
  });

  it('throws if the worker directory is missing', async () => {
    await expect(buildPoolOptions({ outDir, worker: 'missing' })).rejects.toThrow(/Missing/);
  });

  it('throws with hint if outDir exists but worker dir is absent', async () => {
    await writeWranglerConfig(join(outDir, 'other'), {
      name: 'pfx-other',
      main: 'main.ts',
    });

    await expect(buildPoolOptions({ outDir, worker: 'gateway' })).rejects.toThrow(/Missing/);
  });

  it('registers sibling workers referenced via service bindings', async () => {
    await writeWranglerConfig(join(outDir, 'api'), {
      name: 'pfx-api',
      main: '../../src/api.ts',
      compatibility_date: '2026-04-08',
      compatibility_flags: ['nodejs_compat'],
      services: [{ binding: 'DATA', service: 'pfx-data' }],
    });
    await writeWranglerConfig(join(outDir, 'data'), {
      name: 'pfx-data',
      main: '../../src/data.ts',
      compatibility_date: '2026-04-08',
      compatibility_flags: ['nodejs_compat'],
      kv_namespaces: [{ binding: 'KV', id: 'kv-123' }],
      vars: { APP_ENV: 'test' },
    });

    const opts = await buildPoolOptions({ outDir, worker: 'api' });

    expect(opts.miniflare.workers).toHaveLength(1);
    const aux = opts.miniflare.workers![0]!;
    expect(aux.name).toBe('pfx-data');
    expect(aux.modules).toBe(true);
    expect(aux.modulesRoot).toBe(resolve(outDir, 'data'));
    expect(aux.scriptPath).toBe(resolve(outDir, 'data', '../../src/data.ts'));
    expect(aux.compatibilityDate).toBe('2026-04-08');
    expect(aux.compatibilityFlags).toEqual(['nodejs_compat']);
    expect(aux.kvNamespaces).toEqual({ KV: 'kv-123' });
    expect(aux.bindings).toEqual({ APP_ENV: 'test' });
  });

  it('registers a sibling DO host script referenced via durable_objects', async () => {
    await writeWranglerConfig(join(outDir, 'gateway'), {
      name: 'do-demo-gateway',
      main: '../../src/modules/gateway/index.ts',
      compatibility_date: '2026-04-08',
      durable_objects: {
        bindings: [{ name: 'COUNTER', class_name: 'Counter', script_name: 'do-demo-counter' }],
      },
    });
    await writeWranglerConfig(join(outDir, 'counter'), {
      name: 'do-demo-counter',
      main: 'entry.ts',
      compatibility_date: '2026-04-08',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Counter'] }],
    });

    const opts = await buildPoolOptions({ outDir, worker: 'gateway' });

    expect(opts.miniflare.workers).toHaveLength(1);
    const aux = opts.miniflare.workers![0]!;
    expect(aux.name).toBe('do-demo-counter');
    expect(aux.scriptPath).toBe(resolve(outDir, 'counter', 'entry.ts'));
    expect(opts.miniflare.durableObjects).toBeUndefined();
  });

  it('injects a self-binding when the worker under test is a DO host', async () => {
    await writeWranglerConfig(join(outDir, 'counter'), {
      name: 'do-demo-counter',
      main: 'entry.ts',
      compatibility_date: '2026-04-08',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Counter'] }],
    });

    const opts = await buildPoolOptions({ outDir, worker: 'counter' });

    expect(opts.miniflare.durableObjects).toEqual({ COUNTER: 'Counter' });
    expect(opts.miniflare.workers ?? []).toEqual([]);
  });

  it('derives the self-binding class name from the worker short name', async () => {
    await writeWranglerConfig(join(outDir, 'user-session'), {
      name: 'do-demo-user-session',
      main: 'entry.ts',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['UserSession'] }],
    });

    const opts = await buildPoolOptions({ outDir, worker: 'user-session' });

    expect(opts.miniflare.durableObjects).toEqual({ USERSESSION: 'UserSession' });
  });

  it('does not list the worker under test as its own auxiliary', async () => {
    await writeWranglerConfig(join(outDir, 'self'), {
      name: 'pfx-self',
      main: 'main.ts',
      services: [{ binding: 'ME', service: 'pfx-self' }],
    });

    const opts = await buildPoolOptions({ outDir, worker: 'self' });

    expect(opts.miniflare.workers ?? []).toEqual([]);
  });

  it('ignores service bindings that point at external (non-sibling) workers', async () => {
    await writeWranglerConfig(join(outDir, 'api'), {
      name: 'pfx-api',
      main: 'main.ts',
      services: [{ binding: 'EXT', service: 'some-external-worker' }],
    });

    const opts = await buildPoolOptions({ outDir, worker: 'api' });

    expect(opts.miniflare.workers ?? []).toEqual([]);
  });

  it('handles legacy kv-backed DOs via new_classes', async () => {
    await writeWranglerConfig(join(outDir, 'legacy'), {
      name: 'do-legacy',
      main: 'entry.ts',
      migrations: [{ tag: 'v1', new_classes: ['Legacy'] }],
    });

    const opts = await buildPoolOptions({ outDir, worker: 'legacy' });

    expect(opts.miniflare.durableObjects).toEqual({ LEGACY: 'Legacy' });
  });
});
