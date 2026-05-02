import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/runtime/entrypoint', () => import('../_stubs/cloudflare-workers'));

const { defineWorker } = await import('../../src/runtime/define');
const { validateModule, validateRegistry } = await import('../../src/build/internal/validate');

const PREFIX = 'pfx-';

describe('validateModule', () => {
  it('accepts a valid defineWorker module', () => {
    const W = defineWorker({ name: 'demo' }, {
      async fetch() { return new Response(); },
    });
    const result = validateModule('a.ts', W, PREFIX);
    expect(result.ok).toBe(true);
  });

  it('rejects when default export is not a defineWorker product', () => {
    const result = validateModule('a.ts', { name: 'x' }, PREFIX);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]).toMatch(/defineWorker/);
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
});

describe('validateRegistry (cross-module)', () => {
  it('detects duplicate names', () => {
    const W1 = defineWorker({ name: 'dup' }, {});
    const W2 = defineWorker({ name: 'dup' }, {});
    const errors = validateRegistry([
      { file: 'a.ts', worker: W1 },
      { file: 'b.ts', worker: W2 },
    ]);
    expect(errors.some(e => /[Dd]uplicate/.test(e))).toBe(true);
  });

  it('detects unknown service binding name', () => {
    const Caller = defineWorker({
      name: 'caller',
      bindings: { services: { X: { service: 'missing' } } },
    }, {});
    const errors = validateRegistry([{ file: 'a.ts', worker: Caller }]);
    expect(errors.some(e => /missing/.test(e))).toBe(true);
  });

  it('passes when service references resolve', () => {
    const Target = defineWorker({ name: 'target' }, {});
    const Caller = defineWorker({
      name: 'caller',
      bindings: { services: { X: { service: 'target' } } },
    }, {});
    const errors = validateRegistry([
      { file: 't.ts', worker: Target },
      { file: 'c.ts', worker: Caller },
    ]);
    expect(errors).toEqual([]);
  });
});
