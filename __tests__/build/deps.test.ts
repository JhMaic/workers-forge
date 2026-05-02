import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseServiceDeps, resolveClosure } from '../../src/build/internal/deps';

async function writeWrangler(
  dir: string,
  name: string,
  config: object,
): Promise<string> {
  const moduleDir = join(dir, name);
  await mkdir(moduleDir, { recursive: true });
  const file = join(moduleDir, 'wrangler.jsonc');
  await writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
  return file;
}

describe('parseServiceDeps', () => {
  const prefix = 'pfx-';

  it('returns empty when no services field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deps-'));
    const file = await writeWrangler(dir, 'a', { name: 'pfx-a' });
    expect(await parseServiceDeps(file, prefix, 'a')).toEqual([]);
  });

  it('strips prefix from service names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deps-'));
    const file = await writeWrangler(dir, 'a', {
      name: 'pfx-a',
      services: [
        { binding: 'B', service: 'pfx-b' },
        { binding: 'C', service: 'pfx-c' },
      ],
    });
    expect(await parseServiceDeps(file, prefix, 'a')).toEqual(['b', 'c']);
  });

  it('throws on external service (no prefix match)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deps-'));
    const file = await writeWrangler(dir, 'a', {
      services: [{ binding: 'X', service: 'other-worker' }],
    });
    await expect(parseServiceDeps(file, prefix, 'a')).rejects.toThrow(/external service/);
  });

  it('skips self-references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deps-'));
    const file = await writeWrangler(dir, 'a', {
      services: [{ binding: 'SELF', service: 'pfx-a' }],
    });
    expect(await parseServiceDeps(file, prefix, 'a')).toEqual([]);
  });
});

describe('resolveClosure', () => {
  it('returns a single root with no deps', () => {
    const deps = new Map<string, readonly string[]>([['a', []]]);
    expect(resolveClosure(['a'], deps).order).toEqual(['a']);
  });

  it('orders deps before dependers (leaves first)', () => {
    const deps = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
      ['d', []],
    ]);
    expect(resolveClosure(['a'], deps).order).toEqual(['c', 'b', 'a']);
  });

  it('handles multiple roots and shared deps without duplication', () => {
    const deps = new Map<string, readonly string[]>([
      ['a', ['c']],
      ['b', ['c']],
      ['c', []],
    ]);
    const order = resolveClosure(['a', 'b'], deps).order;
    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('throws on unknown root with sorted known list', () => {
    const deps = new Map<string, readonly string[]>([['a', []], ['b', []]]);
    expect(() => resolveClosure(['nope'], deps))
      .toThrow(/unknown worker "nope".*a, b/);
  });

  it('throws on cycle with full path', () => {
    const deps = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    expect(() => resolveClosure(['a'], deps)).toThrow(/cycle.*a → b → c → a/);
  });
});
