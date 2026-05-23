import { describe, expect, it } from 'vitest';
import { mergeUserMiniflareOptions } from '../../src/testing/define-project';

describe('mergeUserMiniflareOptions', () => {
  it('returns the kit object unchanged when the user passes nothing', () => {
    const kit = { workers: [{ name: 'aux' }], durableObjects: { COUNTER: 'Counter' } };

    const out = mergeUserMiniflareOptions(kit, undefined);

    expect(out).toEqual(kit);
  });

  it('passes through user-only top-level keys verbatim', () => {
    const kit = { workers: [{ name: 'aux' }] };
    const user = {
      bindings: { TEST_MIGRATIONS: ['migration-a.sql'] },
      d1Databases: { DATABASE: 'shared-id' },
    };

    const out = mergeUserMiniflareOptions(kit, user);

    expect(out).toEqual({
      workers: [{ name: 'aux' }],
      bindings: { TEST_MIGRATIONS: ['migration-a.sql'] },
      d1Databases: { DATABASE: 'shared-id' },
    });
  });

  it('preserves kit-managed keys when merging', () => {
    const kit = {
      workers: [{ name: 'aux-a' }, { name: 'aux-b' }],
      durableObjects: { COUNTER: 'Counter' },
    };
    const user = { bindings: { FOO: 'bar' } };

    const out = mergeUserMiniflareOptions(kit, user);

    expect(out.workers).toEqual(kit.workers);
    expect(out.durableObjects).toEqual(kit.durableObjects);
    expect(out.bindings).toEqual({ FOO: 'bar' });
  });

  it('throws when the user supplies `workers`', () => {
    const kit = { workers: [{ name: 'aux' }] };
    const user = { workers: [{ name: 'user-aux' }] };

    expect(() => mergeUserMiniflareOptions(kit, user)).toThrow(/workers/);
  });

  it('throws when the user supplies `durableObjects`', () => {
    const kit = { durableObjects: { COUNTER: 'Counter' } };
    const user = { durableObjects: { TEST_FAKE: 'TestFake' } };

    expect(() => mergeUserMiniflareOptions(kit, user)).toThrow(/durableObjects/);
  });

  it('throw mentions workers-forge so the error is grepable', () => {
    const kit = {};
    const user = { workers: [] };

    expect(() => mergeUserMiniflareOptions(kit, user)).toThrow(/workers-forge/);
  });

  it('does not mutate the kit input', () => {
    const kit = { workers: [{ name: 'aux' }] };
    const user = { bindings: { FOO: 'bar' } };
    const snapshot = JSON.parse(JSON.stringify(kit));

    mergeUserMiniflareOptions(kit, user);

    expect(kit).toEqual(snapshot);
  });

  it('shallow-merges: user`s top-level non-conflicting object value wholly replaces missing key', () => {
    // confirms we are not deep-merging: an array passed at a fresh key stays as-is
    const kit = {};
    const user = { compatibilityFlags: ['nodejs_compat', 'foo_flag'] };

    const out = mergeUserMiniflareOptions(kit, user);

    expect(out.compatibilityFlags).toEqual(['nodejs_compat', 'foo_flag']);
  });
});
