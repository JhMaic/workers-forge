import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/runtime/entrypoint', () => import('../_stubs/cloudflare-workers'));

const { defineWorker, getWorkerMeta } = await import('../../src/runtime/define');
const { defineDurableObject, getDurableObjectMeta } = await import('../../src/runtime/durable-object');
const { durableObject } = await import('../../src/runtime/bindings');
const { validateModule, validateRegistry } = await import('../../src/build/internal/validate');

const PREFIX = 'pfx-';

function wrapWorker(file: string, value: ReturnType<typeof defineWorker>) {
  return { kind: 'worker' as const, file, value, meta: getWorkerMeta(value) };
}
function wrapDO(file: string, value: ReturnType<typeof defineDurableObject>) {
  return { kind: 'durable_object' as const, file, value, meta: getDurableObjectMeta(value) };
}

describe('validateModule', () => {
  it('accepts a valid defineWorker module', () => {
    const W = defineWorker({ name: 'demo' }, {
      async fetch() { return new Response(); },
    });
    const result = validateModule('a.ts', W, PREFIX);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.kind).toBe('worker');
  });

  it('accepts a valid defineDurableObject module', () => {
    const D = defineDurableObject({ name: 'counter' }, {
      async ping() { return 'ok'; },
    });
    const result = validateModule('a.ts', D, PREFIX);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.kind).toBe('durable_object');
  });

  it('rejects when default export is neither worker nor DO', () => {
    const result = validateModule('a.ts', { name: 'x' }, PREFIX);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]).toMatch(/defineWorker|defineDurableObject/);
  });

  it('rejects empty name', () => {
    const W = defineWorker({ name: '' as any }, {});
    const r = validateModule('a.ts', W, PREFIX);
    expect(r.ok).toBe(false);
  });

  it('rejects name with invalid chars', () => {
    const W = defineWorker({ name: 'Bad_Name' as any }, {});
    expect(validateModule('a.ts', W, PREFIX).ok).toBe(false);
  });

  it('rejects name exceeding 63 - prefix.length', () => {
    const longName = 'a'.repeat(63 - PREFIX.length + 1);
    const W = defineWorker({ name: longName }, {});
    expect(validateModule('a.ts', W, PREFIX).ok).toBe(false);
  });

  it('rejects malformed cron trigger', () => {
    const W = defineWorker({ name: 'a', triggers: { cron: 123 as any } }, {});
    expect(validateModule('a.ts', W, PREFIX).ok).toBe(false);
  });

  it('rejects DO with invalid storage value', () => {
    const D = defineDurableObject({ name: 'd', storage: 'invalid' as any }, {});
    const r = validateModule('a.ts', D, PREFIX);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.some(e => /storage/.test(e))).toBe(true);
  });

  it('rejects DO whose derived class name is not a valid identifier', () => {
    // '123-test' splits to ['123', 'test'], joined as '123Test' — starts with digit.
    const D = defineDurableObject({ name: '123-test' as any }, {});
    const r = validateModule('a.ts', D, PREFIX);
    expect(r.ok).toBe(false);
  });
});

describe('validateRegistry (cross-module)', () => {
  it('detects duplicate names', () => {
    const W1 = defineWorker({ name: 'dup' }, {});
    const W2 = defineWorker({ name: 'dup' }, {});
    const errors = validateRegistry([wrapWorker('a.ts', W1), wrapWorker('b.ts', W2)]);
    expect(errors.some(e => /[Dd]uplicate/.test(e))).toBe(true);
  });

  it('detects unknown service binding name', () => {
    const Caller = defineWorker({
      name: 'caller',
      bindings: { services: { X: { service: 'missing' } } },
    }, {});
    const errors = validateRegistry([wrapWorker('a.ts', Caller)]);
    expect(errors.some(e => /missing/.test(e))).toBe(true);
  });

  it('passes when service references resolve', () => {
    const Target = defineWorker({ name: 'target' }, {});
    const Caller = defineWorker({
      name: 'caller',
      bindings: { services: { X: { service: 'target' } } },
    }, {});
    const errors = validateRegistry([wrapWorker('t.ts', Target), wrapWorker('c.ts', Caller)]);
    expect(errors).toEqual([]);
  });

  it('detects unknown durable_objects binding scriptName', () => {
    const Caller = defineWorker({
      name: 'caller',
      bindings: { durable_objects: { DO: durableObject('missing-do') } },
    }, {});
    const errors = validateRegistry([wrapWorker('a.ts', Caller)]);
    expect(errors.some(e => /missing-do/.test(e))).toBe(true);
  });

  it('passes when durable_objects references resolve to a DO module', () => {
    const Counter = defineDurableObject({ name: 'counter' }, {});
    const Caller = defineWorker({
      name: 'caller',
      bindings: { durable_objects: { COUNTER: durableObject('counter') } },
    }, {});
    const errors = validateRegistry([wrapDO('d.ts', Counter), wrapWorker('c.ts', Caller)]);
    expect(errors).toEqual([]);
  });

  it('rejects when durable_objects references a worker (not a DO)', () => {
    const Other = defineWorker({ name: 'other' }, {});
    const Caller = defineWorker({
      name: 'caller',
      bindings: { durable_objects: { OTHER: durableObject('other') } },
    }, {});
    const errors = validateRegistry([wrapWorker('o.ts', Other), wrapWorker('c.ts', Caller)]);
    expect(errors.some(e => /is a worker, not a DO/.test(e))).toBe(true);
  });
});
