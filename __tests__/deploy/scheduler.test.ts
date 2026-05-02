import type { DeployGraph, DeployNode } from '../../src/deploy/planner';
import type { RunWorkerFn, WorkerRunResult } from '../../src/deploy/scheduler';
import { describe, expect, it, vi } from 'vitest';
import { runScheduler } from '../../src/deploy/scheduler';

function graph(spec: Record<string, string[]>): DeployGraph {
  const nodes = new Map<string, DeployNode>();
  for (const [name, deps] of Object.entries(spec)) {
    nodes.set(name, { name, fullName: `p-${name}`, configPath: `/tmp/${name}/wrangler.jsonc`, deps: [...deps], dependents: [] });
  }
  for (const [name, deps] of Object.entries(spec)) {
    for (const d of deps) nodes.get(d)!.dependents.push(name);
  }
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n))
      return;
    for (const d of nodes.get(n)!.deps) visit(d);
    seen.add(n);
    order.push(n);
  };
  for (const n of nodes.keys()) visit(n);
  return { nodes, order };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('runScheduler()', () => {
  it('runs a single node and returns done', async () => {
    const g = graph({ a: [] });
    const run: RunWorkerFn = async () => ({ status: 'done' });
    const result = await runScheduler(g, run);
    expect(result.done).toEqual(['a']);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('runs ready nodes concurrently before their dependents', async () => {
    const g = graph({ a: [], b: [], c: ['a', 'b'] });
    const dA = deferred<void>();
    const dB = deferred<void>();
    const started: string[] = [];
    const run: RunWorkerFn = async (node) => {
      started.push(node.name);
      if (node.name === 'a')
        await dA.promise;
      if (node.name === 'b')
        await dB.promise;
      return { status: 'done' };
    };
    const p = runScheduler(g, run);
    await new Promise(r => setTimeout(r, 0));
    expect(started).toEqual(expect.arrayContaining(['a', 'b']));
    expect(started).not.toContain('c');
    dA.resolve();
    dB.resolve();
    const r = await p;
    expect(r.done).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('skips transitive dependents when a node fails; siblings continue', async () => {
    const g = graph({ a: [], b: ['a'], c: ['b'], d: ['a'], e: [] });
    const run: RunWorkerFn = async (node) => {
      if (node.name === 'b')
        return { status: 'failed', output: 'boom' };
      return { status: 'done' };
    };
    const r = await runScheduler(g, run);
    expect(r.done.sort()).toEqual(['a', 'd', 'e']);
    expect(r.failed.map(f => f.name)).toEqual(['b']);
    expect(r.failed[0].output).toBe('boom');
    expect(r.skipped.map(s => s.name)).toEqual(['c']);
    expect(r.skipped[0].reason).toBe('b');
  });

  it('respects concurrency=1 (serial)', async () => {
    const g = graph({ a: [], b: [], c: [] });
    const inflight: string[] = [];
    let maxInflight = 0;
    const run: RunWorkerFn = async (node) => {
      inflight.push(node.name);
      maxInflight = Math.max(maxInflight, inflight.length);
      await new Promise(r => setTimeout(r, 5));
      inflight.splice(inflight.indexOf(node.name), 1);
      return { status: 'done' };
    };
    await runScheduler(g, run, { concurrency: 1 });
    expect(maxInflight).toBe(1);
  });

  it('emits onStateChange for every transition', async () => {
    const g = graph({ a: [], b: ['a'] });
    const events: [string, string, string][] = [];
    const run: RunWorkerFn = async () => ({ status: 'done' });
    await runScheduler(g, run, {
      hooks: { onStateChange: (n, p, x) => events.push([n, p, x]) },
    });
    expect(events).toEqual(expect.arrayContaining([
      ['a', 'pending', 'running'],
      ['a', 'running', 'done'],
      ['b', 'pending', 'running'],
      ['b', 'running', 'done'],
    ]));
  });

  it('aborts in-flight workers when AbortSignal fires', async () => {
    const g = graph({ a: [] });
    const run: RunWorkerFn = vi.fn(async (_n, signal): Promise<WorkerRunResult> => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return { status: 'done' };
    });
    const ctrl = new AbortController();
    const p = runScheduler(g, run, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toThrow(/aborted/);
  });
});
