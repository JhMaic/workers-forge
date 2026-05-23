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

  it('returns mainConfigPath for the worker under test', async () => {
    await writeWranglerConfig(join(outDir, 'gateway'), {
      name: 'pfx-gateway',
      main: '../../src/modules/gateway/index.ts',
    });

    const d = await buildPoolOptions({ outDir, worker: 'gateway' });

    expect(d.mainConfigPath).toBe(resolve(outDir, 'gateway', 'wrangler.jsonc'));
    expect(d.siblings).toEqual([]);
    expect(d.selfDurableObjectBinding).toBeUndefined();
  });

  it('throws if the worker directory is missing', async () => {
    await expect(buildPoolOptions({ outDir, worker: 'missing' })).rejects.toThrow(/Missing/);
  });

  it('lists siblings referenced via service bindings', async () => {
    await writeWranglerConfig(join(outDir, 'api'), {
      name: 'pfx-api',
      main: '../../src/api.ts',
      services: [{ binding: 'DATA', service: 'pfx-data' }],
    });
    await writeWranglerConfig(join(outDir, 'data'), {
      name: 'pfx-data',
      main: '../../src/data.ts',
    });

    const d = await buildPoolOptions({ outDir, worker: 'api' });

    expect(d.siblings).toEqual([
      { configPath: resolve(outDir, 'data', 'wrangler.jsonc'), deployedName: 'pfx-data' },
    ]);
  });

  it('lists a sibling DO host script referenced via durable_objects', async () => {
    await writeWranglerConfig(join(outDir, 'gateway'), {
      name: 'do-demo-gateway',
      main: '../../src/modules/gateway/index.ts',
      durable_objects: {
        bindings: [{ name: 'COUNTER', class_name: 'Counter', script_name: 'do-demo-counter' }],
      },
    });
    await writeWranglerConfig(join(outDir, 'counter'), {
      name: 'do-demo-counter',
      main: 'entry.ts',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Counter'] }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'gateway' });

    expect(d.siblings).toEqual([
      { configPath: resolve(outDir, 'counter', 'wrangler.jsonc'), deployedName: 'do-demo-counter' },
    ]);
    expect(d.selfDurableObjectBinding).toBeUndefined();
  });

  it('injects a self-binding when the worker under test is a DO host (sqlite)', async () => {
    await writeWranglerConfig(join(outDir, 'counter'), {
      name: 'do-demo-counter',
      main: 'entry.ts',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Counter'] }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'counter' });

    expect(d.selfDurableObjectBinding).toEqual({ binding: 'COUNTER', className: 'Counter' });
    expect(d.siblings).toEqual([]);
  });

  it('injects a self-binding for legacy kv-backed DOs (new_classes)', async () => {
    await writeWranglerConfig(join(outDir, 'legacy'), {
      name: 'do-legacy',
      main: 'entry.ts',
      migrations: [{ tag: 'v1', new_classes: ['Legacy'] }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'legacy' });

    expect(d.selfDurableObjectBinding).toEqual({ binding: 'LEGACY', className: 'Legacy' });
  });

  it('derives the self-binding class name from a kebab/snake worker name', async () => {
    await writeWranglerConfig(join(outDir, 'user-session'), {
      name: 'do-demo-user-session',
      main: 'entry.ts',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['UserSession'] }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'user-session' });

    expect(d.selfDurableObjectBinding).toEqual({ binding: 'USERSESSION', className: 'UserSession' });
  });

  it('does not list the worker under test as its own sibling', async () => {
    await writeWranglerConfig(join(outDir, 'self'), {
      name: 'pfx-self',
      main: 'main.ts',
      services: [{ binding: 'ME', service: 'pfx-self' }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'self' });

    expect(d.siblings).toEqual([]);
  });

  it('ignores service bindings that point at external (non-sibling) workers', async () => {
    await writeWranglerConfig(join(outDir, 'api'), {
      name: 'pfx-api',
      main: 'main.ts',
      services: [{ binding: 'EXT', service: 'some-external-worker' }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'api' });

    expect(d.siblings).toEqual([]);
  });

  it('discovers transitive siblings via service bindings (A → B → C)', async () => {
    await writeWranglerConfig(join(outDir, 'gateway'), {
      name: 'pfx-gateway',
      main: 'gateway.ts',
      services: [{ binding: 'SVC', service: 'pfx-service' }],
    });
    await writeWranglerConfig(join(outDir, 'service'), {
      name: 'pfx-service',
      main: 'service.ts',
      services: [{ binding: 'REPO', service: 'pfx-repo' }],
    });
    await writeWranglerConfig(join(outDir, 'repo'), {
      name: 'pfx-repo',
      main: 'repo.ts',
    });

    const d = await buildPoolOptions({ outDir, worker: 'gateway' });

    const deployedNames = d.siblings.map(s => s.deployedName).sort();
    expect(deployedNames).toEqual(['pfx-repo', 'pfx-service']);
  });

  it('discovers transitive DO siblings when an aux DO references another DO', async () => {
    // Mirrors the reported topology:
    //   webhook-line (main) → friend-do (DO, aux) → scheduler-do (DO, 2-hop)
    await writeWranglerConfig(join(outDir, 'webhook-line'), {
      name: 'linehub-webhook-line-local',
      main: 'webhook.ts',
      durable_objects: {
        bindings: [{ name: 'FRIEND_DO', class_name: 'FriendDo', script_name: 'linehub-friend-do-local' }],
      },
    });
    await writeWranglerConfig(join(outDir, 'friend-do'), {
      name: 'linehub-friend-do-local',
      main: 'friend.ts',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['FriendDo'] }],
      durable_objects: {
        bindings: [
          { name: 'SCHEDULER_DO', class_name: 'SchedulerDo', script_name: 'linehub-scheduler-do-local' },
        ],
      },
    });
    await writeWranglerConfig(join(outDir, 'scheduler-do'), {
      name: 'linehub-scheduler-do-local',
      main: 'scheduler.ts',
      migrations: [{ tag: 'v1', new_sqlite_classes: ['SchedulerDo'] }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'webhook-line' });

    const deployedNames = d.siblings.map(s => s.deployedName).sort();
    expect(deployedNames).toEqual(['linehub-friend-do-local', 'linehub-scheduler-do-local']);
  });

  it('terminates on cycles between aux workers', async () => {
    // main → A → B → A (cycle between siblings)
    await writeWranglerConfig(join(outDir, 'main'), {
      name: 'pfx-main',
      main: 'main.ts',
      services: [{ binding: 'A', service: 'pfx-a' }],
    });
    await writeWranglerConfig(join(outDir, 'a'), {
      name: 'pfx-a',
      main: 'a.ts',
      services: [{ binding: 'B', service: 'pfx-b' }],
    });
    await writeWranglerConfig(join(outDir, 'b'), {
      name: 'pfx-b',
      main: 'b.ts',
      services: [{ binding: 'A', service: 'pfx-a' }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'main' });

    const deployedNames = d.siblings.map(s => s.deployedName).sort();
    expect(deployedNames).toEqual(['pfx-a', 'pfx-b']);
  });

  it('does not re-add the worker under test when an aux references it back', async () => {
    // main → A → main (sibling back-references the worker under test)
    await writeWranglerConfig(join(outDir, 'main'), {
      name: 'pfx-main',
      main: 'main.ts',
      services: [{ binding: 'A', service: 'pfx-a' }],
    });
    await writeWranglerConfig(join(outDir, 'a'), {
      name: 'pfx-a',
      main: 'a.ts',
      services: [{ binding: 'MAIN', service: 'pfx-main' }],
    });

    const d = await buildPoolOptions({ outDir, worker: 'main' });

    const deployedNames = d.siblings.map(s => s.deployedName).sort();
    expect(deployedNames).toEqual(['pfx-a']);
  });
});
