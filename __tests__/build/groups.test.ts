import { describe, expect, it } from 'vitest';
import {
  assertPortKeysNotInsideGroup,
  expandWorkersToUnitKeys,
  planGroups,
} from '../../src/build/internal/groups';

describe('planGroups()', () => {
  it('returns N solo units when no groups are declared', () => {
    const plan = planGroups(['a', 'b', 'c'], undefined);
    expect(plan.units).toEqual([
      { kind: 'solo', key: 'a', members: ['a'] },
      { kind: 'solo', key: 'b', members: ['b'] },
      { kind: 'solo', key: 'c', members: ['c'] },
    ]);
    expect(plan.groupOf.size).toBe(0);
  });

  it('emits groups in declared key order, then solos in allNames order', () => {
    const plan = planGroups(['a', 'b', 'c', 'd'], {
      'pair': ['b', 'c'],
    });
    expect(plan.units.map(u => u.key)).toEqual(['pair', 'a', 'd']);
    expect(plan.units[0]).toEqual({ kind: 'group', key: 'pair', members: ['b', 'c'] });
    expect(plan.groupOf.get('b')).toBe('pair');
    expect(plan.groupOf.get('c')).toBe('pair');
    expect(plan.groupOf.has('a')).toBe(false);
  });

  it('preserves declared member order inside a group (first = primary)', () => {
    const plan = planGroups(['x', 'y', 'z'], { stack: ['z', 'x', 'y'] });
    expect(plan.units[0]!.members).toEqual(['z', 'x', 'y']);
  });

  it('rejects a group name that collides with an existing worker short name', () => {
    expect(() => planGroups(['a', 'b'], { a: ['a', 'b'] })).toThrow(
      /collides with an existing worker short name/,
    );
  });

  it('rejects a group name that does not match WORKER_NAME_REGEX', () => {
    expect(() => planGroups(['a', 'b'], { 'Bad Name': ['a', 'b'] })).toThrow(
      /invalid: must match/,
    );
  });

  it('rejects a group name longer than 63 characters', () => {
    const longName = 'g'.repeat(64);
    expect(() => planGroups(['a', 'b'], { [longName]: ['a', 'b'] })).toThrow(
      /exceeds 63 characters/,
    );
  });

  it('rejects a group with fewer than 2 members', () => {
    expect(() => planGroups(['a', 'b'], { solo: ['a'] })).toThrow(
      /at least 2 worker short names/,
    );
    expect(() => planGroups(['a', 'b'], { empty: [] })).toThrow(
      /at least 2 worker short names/,
    );
  });

  it('rejects a group with duplicate members', () => {
    expect(() => planGroups(['a', 'b'], { dup: ['a', 'a'] })).toThrow(
      /lists "a" more than once/,
    );
  });

  it('rejects a group referencing an unknown worker', () => {
    expect(() => planGroups(['a', 'b'], { g: ['a', 'ghost'] })).toThrow(
      /references unknown worker "ghost"/,
    );
  });

  it('rejects a worker that appears in two groups', () => {
    expect(() => planGroups(['a', 'b', 'c'], {
      g1: ['a', 'b'],
      g2: ['b', 'c'],
    })).toThrow(/appears in both dev\.groups\["g1"\] and dev\.groups\["g2"\]/);
  });
});

describe('assertPortKeysNotInsideGroup()', () => {
  it('no-ops when ports is undefined', () => {
    expect(() => assertPortKeysNotInsideGroup(undefined, new Map())).not.toThrow();
  });

  it('throws with a hint when a port key names a worker inside a group', () => {
    const groupOf = new Map([['producer', 'queue-stack'], ['consumer-a', 'queue-stack']]);
    expect(() => assertPortKeysNotInsideGroup({ producer: 8787 }, groupOf)).toThrow(
      /dev\.ports\["producer"\] refers to a worker inside group "queue-stack".*use the group name "queue-stack"/,
    );
  });

  it('allows a port key that matches an ungrouped worker or a group name', () => {
    const groupOf = new Map([['producer', 'queue-stack']]);
    expect(() => assertPortKeysNotInsideGroup(
      { 'queue-stack': 8787, 'other-solo': 9000 },
      groupOf,
    )).not.toThrow();
  });
});

describe('expandWorkersToUnitKeys()', () => {
  it('maps ungrouped workers to themselves', () => {
    expect(expandWorkersToUnitKeys(['a', 'b'], new Map())).toEqual(['a', 'b']);
  });

  it('replaces grouped workers with their group name', () => {
    const groupOf = new Map([['producer', 'queue-stack'], ['consumer-a', 'queue-stack']]);
    expect(expandWorkersToUnitKeys(['producer'], groupOf)).toEqual(['queue-stack']);
  });

  it('deduplicates when multiple members of the same group are listed', () => {
    const groupOf = new Map([['producer', 'queue-stack'], ['consumer-a', 'queue-stack']]);
    expect(expandWorkersToUnitKeys(['producer', 'consumer-a'], groupOf))
      .toEqual(['queue-stack']);
  });

  it('preserves the first-seen order across mixed grouped/solo inputs', () => {
    const groupOf = new Map([['p', 'g1'], ['c', 'g1']]);
    expect(expandWorkersToUnitKeys(['solo-a', 'p', 'solo-b', 'c'], groupOf))
      .toEqual(['solo-a', 'g1', 'solo-b']);
  });
});
