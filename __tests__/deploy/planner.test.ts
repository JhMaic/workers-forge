import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGraph } from '../../src/deploy/planner';

async function writeCfg(dir: string, name: string, cfg: object): Promise<string> {
  const m = join(dir, name);
  await mkdir(m, { recursive: true });
  const f = join(m, 'wrangler.jsonc');
  await writeFile(f, JSON.stringify(cfg, null, 2), 'utf-8');
  return f;
}

describe('loadGraph()', () => {
  it('builds a single-node graph with no deps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const a = await writeCfg(dir, 'a', { name: 'p-a' });
    const g = await loadGraph([a], 'p-');
    expect([...g.nodes.keys()]).toEqual(['a']);
    expect(g.nodes.get('a')!.deps).toEqual([]);
    expect(g.nodes.get('a')!.dependents).toEqual([]);
    expect(g.order).toEqual(['a']);
  });

  it('records deps and dependents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const a = await writeCfg(dir, 'a', { name: 'p-a', services: [{ binding: 'B', service: 'p-b' }] });
    const b = await writeCfg(dir, 'b', { name: 'p-b' });
    const g = await loadGraph([a, b], 'p-');
    expect(g.nodes.get('a')!.deps).toEqual(['b']);
    expect(g.nodes.get('b')!.dependents).toEqual(['a']);
    expect(g.order).toEqual(['b', 'a']);
  });

  it('throws on cycles with a path message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const a = await writeCfg(dir, 'a', { name: 'p-a', services: [{ binding: 'B', service: 'p-b' }] });
    const b = await writeCfg(dir, 'b', { name: 'p-b', services: [{ binding: 'A', service: 'p-a' }] });
    await expect(loadGraph([a, b], 'p-')).rejects.toThrow(/cycle detected/);
  });

  it('ignores external service bindings (not built locally)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const a = await writeCfg(dir, 'a', { name: 'p-a', services: [{ binding: 'X', service: 'unrelated' }] });
    const g = await loadGraph([a], 'p-');
    expect(g.nodes.get('a')!.deps).toEqual([]);
  });

  it('throws when wrangler.jsonc is missing the name field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const a = await writeCfg(dir, 'a', { services: [] });
    await expect(loadGraph([a], 'p-')).rejects.toThrow(/missing required "name"/);
  });

  it('records fullName as the value from wrangler.jsonc (incl. env suffix)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const a = await writeCfg(dir, 'a', { name: 'p-a-stg' });
    const g = await loadGraph([a], 'p-');
    expect(g.nodes.get('a')!.fullName).toBe('p-a-stg');
  });
});
