import { describe, expect, it } from 'vitest';
import { defaultBaseConfig } from '../../src/build/base-config';
import { mergeWranglerConfig } from '../../src/build/internal/merge';

describe('mergeWranglerConfig', () => {
  it('produces minimal config with prefixed name', () => {
    const config = mergeWranglerConfig({
      moduleName: 'demo',
      prefix: 'pfx-',
      sourcePath: '../../src/modules/demo/index.ts',
      meta: { name: 'demo' },
      base: defaultBaseConfig,
    });
    expect(config.name).toBe('pfx-demo');
    expect(config.main).toBe('../../src/modules/demo/index.ts');
    expect(config.compatibility_date).toBe(defaultBaseConfig.compatibility_date);
    expect(config.compatibility_flags).toEqual(defaultBaseConfig.compatibility_flags);
  });

  it('rewrites sibling service names with prefix and leaves external untouched', () => {
    const config = mergeWranglerConfig({
      moduleName: 'consumer',
      prefix: 'pfx-',
      sourcePath: 's',
      meta: {
        name: 'consumer',
        bindings: {
          services: {
            SIB: { service: 'producer' },
            EXT: { service: 'some-other-worker' },
            STG: { service: 'producer', environment: 'staging' },
          },
        },
      },
      base: defaultBaseConfig,
      siblings: new Set(['consumer', 'producer']),
    });
    expect(config.services).toEqual([
      { binding: 'SIB', service: 'pfx-producer' },
      { binding: 'EXT', service: 'some-other-worker' },
      { binding: 'STG', service: 'pfx-producer', environment: 'staging' },
    ]);
  });

  it('merges binding fields and strips __rpc from services', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'pfx-',
      sourcePath: 'src.ts',
      meta: {
        name: 'a',
        bindings: {
          kv_namespaces: [{ binding: 'CACHE', id: 'abc' }],
          services: { X: { service: 'b', __rpc: undefined as any } },
          vars: { K: 'v' },
        },
      },
      base: defaultBaseConfig,
    });
    expect(config.kv_namespaces).toEqual([{ binding: 'CACHE', id: 'abc' }]);
    expect(config.services).toEqual([{ binding: 'X', service: 'b' }]);
    expect((config.services as any[])[0]).not.toHaveProperty('__rpc');
    expect(config.vars).toEqual({ K: 'v' });
  });

  it('merges trigger fields (cron, queue consumers, tail)', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'p-',
      sourcePath: 's',
      meta: {
        name: 'a',
        triggers: {
          cron: '*/5 * * * *',
          queue: { consumers: [{ queue: 'q' }] },
          tail: { producers: [{ service: 'svc' }] },
        },
      },
      base: defaultBaseConfig,
    });
    expect(config.triggers).toEqual({ crons: ['*/5 * * * *'] });
    expect((config.queues as any).consumers).toEqual([{ queue: 'q' }]);
    expect(config.tail_consumers).toEqual([{ service: 'svc' }]);
  });

  it('combines bindings.queues.producers with triggers.queue.consumers', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'p-',
      sourcePath: 's',
      meta: {
        name: 'a',
        bindings: { queues: { producers: [{ binding: 'Q', queue: 'q-out' }] } },
        triggers: { queue: { consumers: [{ queue: 'q-in' }] } },
      },
      base: defaultBaseConfig,
    });
    expect(config.queues).toEqual({
      producers: [{ binding: 'Q', queue: 'q-out' }],
      consumers: [{ queue: 'q-in' }],
    });
  });

  it('passes extra baseConfig fields through to the output', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'pfx-',
      sourcePath: 'src.ts',
      meta: { name: 'a' },
      base: { ...defaultBaseConfig, no_bundle: true, upload_source_maps: true },
    });
    expect(config.no_bundle).toBe(true);
    expect(config.upload_source_maps).toBe(true);
    // module-controlled fields still win over base
    expect(config.name).toBe('pfx-a');
    expect(config.main).toBe('src.ts');
  });

  it('_raw overrides baseConfig fields', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'pfx-',
      sourcePath: 'src.ts',
      meta: {
        name: 'a',
        _raw: { no_bundle: true, limits: { cpu_ms: 500 } },
      },
      base: { ...defaultBaseConfig, no_bundle: false },
    });
    expect(config.no_bundle).toBe(true);
    expect((config.limits as any).cpu_ms).toBe(500);
  });

  it('_raw overrides meta binding fields', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'pfx-',
      sourcePath: 'src.ts',
      meta: {
        name: 'a',
        bindings: { vars: { FOO: 'original' } },
        _raw: { vars: { FOO: 'overridden', EXTRA: 'injected' } },
      },
      base: defaultBaseConfig,
    });
    expect(config.vars).toEqual({ FOO: 'overridden', EXTRA: 'injected' });
  });

  it('_raw services are NOT name-rewritten', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'pfx-',
      sourcePath: 'src.ts',
      meta: {
        name: 'a',
        _raw: {
          services: [{ binding: 'RAW_SVC', service: 'sibling-worker' }],
        },
      },
      base: defaultBaseConfig,
      siblings: new Set(['a', 'sibling-worker']),
      suffix: '-prod',
    });
    // _raw content passes through verbatim — no prefix/suffix added
    expect(config.services).toEqual([{ binding: 'RAW_SVC', service: 'sibling-worker' }]);
  });

  it('_raw has highest priority: base < meta bindings < _raw', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'pfx-',
      sourcePath: 'src.ts',
      meta: {
        name: 'a',
        bindings: { vars: { K: 'from-meta' } },
        _raw: { vars: { K: 'from-raw' }, no_bundle: true },
      },
      base: { ...defaultBaseConfig, no_bundle: false },
    });
    expect((config.vars as any).K).toBe('from-raw');
    expect(config.no_bundle).toBe(true);
  });
});
