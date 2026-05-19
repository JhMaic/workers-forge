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

  describe('durable_objects bindings', () => {
    it('emits durable_objects.bindings with derived class_name and rewritten sibling script_name', () => {
      const config = mergeWranglerConfig({
        moduleName: 'gateway',
        prefix: 'pfx-',
        sourcePath: 'src.ts',
        meta: {
          name: 'gateway',
          bindings: {
            durable_objects: {
              COUNTER: { scriptName: 'counter' },
              EXT: { scriptName: 'external-do' },
              STG: { scriptName: 'counter', environment: 'staging' },
            },
          },
        },
        base: defaultBaseConfig,
        siblings: new Set(['gateway', 'counter']),
      });
      expect(config.durable_objects).toEqual({
        bindings: [
          { name: 'COUNTER', class_name: 'Counter', script_name: 'pfx-counter' },
          { name: 'EXT', class_name: 'ExternalDo', script_name: 'external-do' },
          { name: 'STG', class_name: 'Counter', script_name: 'pfx-counter', environment: 'staging' },
        ],
      });
    });

    it('applies suffix to sibling DO script_name', () => {
      const config = mergeWranglerConfig({
        moduleName: 'gateway',
        prefix: 'pfx-',
        sourcePath: 'src.ts',
        meta: {
          name: 'gateway',
          bindings: { durable_objects: { COUNTER: { scriptName: 'counter' } } },
        },
        base: defaultBaseConfig,
        siblings: new Set(['gateway', 'counter']),
        suffix: '-stage',
      });
      expect((config.durable_objects as any).bindings[0].script_name).toBe('pfx-counter-stage');
    });
  });

  describe('durable_object module (host)', () => {
    it('auto-generates sqlite migration with derived class name', () => {
      const config = mergeWranglerConfig({
        moduleName: 'counter',
        prefix: 'pfx-',
        sourcePath: 'entry.ts',
        meta: { name: 'counter' },
        kind: 'durable_object',
        base: defaultBaseConfig,
      });
      expect(config.migrations).toEqual([
        { tag: 'v1', new_sqlite_classes: ['Counter'] },
      ]);
      // Host script does not auto-bind to its own DO — user must opt in.
      expect(config.durable_objects).toBeUndefined();
    });

    it('routes storage="kv" to new_classes instead of new_sqlite_classes', () => {
      const config = mergeWranglerConfig({
        moduleName: 'counter',
        prefix: 'pfx-',
        sourcePath: 'entry.ts',
        meta: { name: 'counter', storage: 'kv' },
        kind: 'durable_object',
        base: defaultBaseConfig,
      });
      expect(config.migrations).toEqual([
        { tag: 'v1', new_classes: ['Counter'] },
      ]);
    });

    it('derives class name from kebab-case module name', () => {
      const config = mergeWranglerConfig({
        moduleName: 'user-session-store',
        prefix: 'pfx-',
        sourcePath: 'entry.ts',
        meta: { name: 'user-session-store' },
        kind: 'durable_object',
        base: defaultBaseConfig,
      });
      expect((config.migrations as any[])[0].new_sqlite_classes).toEqual(['UserSessionStore']);
    });

    it('_raw.migrations overrides auto-generated migration', () => {
      const config = mergeWranglerConfig({
        moduleName: 'counter',
        prefix: 'pfx-',
        sourcePath: 'entry.ts',
        meta: {
          name: 'counter',
          _raw: {
            migrations: [
              { tag: 'v1', new_sqlite_classes: ['Counter'] },
              { tag: 'v2', renamed_classes: [{ from: 'Counter', to: 'CounterV2' }] },
            ],
          },
        },
        kind: 'durable_object',
        base: defaultBaseConfig,
      });
      expect(config.migrations).toHaveLength(2);
      expect((config.migrations as any[])[1].tag).toBe('v2');
    });

    it('does NOT emit triggers for DO modules even if meta has trigger-shaped fields', () => {
      const config = mergeWranglerConfig({
        moduleName: 'counter',
        prefix: 'pfx-',
        sourcePath: 'entry.ts',
        meta: { name: 'counter' },
        kind: 'durable_object',
        base: defaultBaseConfig,
      });
      expect(config.triggers).toBeUndefined();
      expect(config.tail_consumers).toBeUndefined();
    });
  });
});
