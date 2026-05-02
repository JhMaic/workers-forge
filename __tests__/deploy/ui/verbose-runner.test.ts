import type { DeployGraph, DeployNode } from '../../../src/deploy/planner';
import type { RunWorkerFn } from '../../../src/deploy/scheduler';
import { describe, expect, it } from 'vitest';
import { runWithVerbose } from '../../../src/deploy/ui/verbose-runner';

function g(spec: Record<string, string[]>): DeployGraph {
  const nodes = new Map<string, DeployNode>();
  for (const [n, deps] of Object.entries(spec))
    nodes.set(n, { name: n, fullName: `p-${n}`, configPath: '', deps, dependents: [] });
  for (const [n, deps] of Object.entries(spec)) {
    for (const d of deps) nodes.get(d)!.dependents.push(n);
  }
  return { nodes, order: Object.keys(spec) };
}

describe('runWithVerbose()', () => {
  it('prints state transitions and prefixed worker output', async () => {
    const lines: string[] = [];
    const log = (s: string) => lines.push(s);
    const run: RunWorkerFn = async () => ({ status: 'done' });
    await runWithVerbose(g({ a: [] }), run, { log, errorLog: log });
    const joined = lines.join('\n');
    expect(joined).toMatch(/▶.*p-a.*started/);
    expect(joined).toMatch(/✔.*p-a.*done/);
  });

  it('prints failure state transition', async () => {
    const lines: string[] = [];
    const run: RunWorkerFn = async () => ({ status: 'failed', output: 'err-trace' });
    await runWithVerbose(g({ a: [] }), run, { log: l => lines.push(l), errorLog: l => lines.push(l) });
    const joined = lines.join('\n');
    expect(joined).toContain('✖');
  });
});
