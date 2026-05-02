import type { DeployGraph, DeployNode } from '../../../src/deploy/planner';
import type { RunWorkerFn } from '../../../src/deploy/scheduler';
import { Buffer } from 'node:buffer';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runWithTree } from '../../../src/deploy/ui/tree-runner';

function makeGraph(spec: Record<string, string[]>): DeployGraph {
  const nodes = new Map<string, DeployNode>();
  for (const [n, deps] of Object.entries(spec))
    nodes.set(n, { name: n, fullName: `p-${n}`, configPath: '', deps, dependents: [] });
  for (const [n, deps] of Object.entries(spec)) {
    for (const d of deps) nodes.get(d)!.dependents.push(n);
  }
  return { nodes, order: Object.keys(spec) };
}

function makeOut(): { stream: NodeJS.WriteStream; captured: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  }) as unknown as NodeJS.WriteStream;
  return { stream, captured: () => Buffer.concat(chunks).toString() };
}

describe('runWithTree()', () => {
  it('returns correct done/failed/skipped', async () => {
    const { stream } = makeOut();
    const run: RunWorkerFn = async (node) => {
      if (node.name === 'b')
        return { status: 'failed', output: 'oops' };
      return { status: 'done' };
    };
    const r = await runWithTree(makeGraph({ a: [], b: ['a'], c: ['b'] }), run, { out: stream });
    expect(r.done).toEqual(['a']);
    expect(r.failed.map(f => f.name)).toEqual(['b']);
    expect(r.skipped.map(s => s.name)).toEqual(['c']);
  });

  it('writes tree output to the provided stream', async () => {
    const { stream, captured } = makeOut();
    const run: RunWorkerFn = async () => ({ status: 'done' });
    await runWithTree(makeGraph({ a: [] }), run, { out: stream });
    expect(captured()).toContain('p-a');
  });

  it('clears animated tree on completion (writes ANSI cursor-up)', async () => {
    const { stream, captured } = makeOut();
    const run: RunWorkerFn = async () => ({ status: 'done' });
    await runWithTree(makeGraph({ a: [] }), run, { out: stream });
    // Expect the ESC[A cursor-up sequence in the output (used for in-place re-render and final clear)
    expect(captured()).toContain('\x1B[');
  });

  it('does not throw when all nodes fail', async () => {
    const { stream } = makeOut();
    const run: RunWorkerFn = async () => ({ status: 'failed', output: 'err' });
    await expect(
      runWithTree(makeGraph({ a: [] }), run, { out: stream }),
    ).resolves.toBeDefined();
  });
});
