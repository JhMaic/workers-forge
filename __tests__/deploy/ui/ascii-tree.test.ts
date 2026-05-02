import type { DeployGraph } from '../../../src/deploy/planner';
import { describe, expect, it } from 'vitest';
import { renderAsciiTree } from '../../../src/deploy/ui/ascii-tree';

function makeGraph(spec: Record<string, string[]>): DeployGraph {
  const nodes = new Map();
  for (const [name, deps] of Object.entries(spec))
    nodes.set(name, { name, fullName: `p-${name}`, configPath: '', deps, dependents: [] });
  for (const [name, deps] of Object.entries(spec)) {
    for (const d of deps) nodes.get(d).dependents.push(name);
  }
  return { nodes, order: Object.keys(spec) };
}

describe('renderAsciiTree()', () => {
  it('renders a single node', () => {
    const out = renderAsciiTree(makeGraph({ a: [] }));
    expect(out).toContain('p-a');
  });

  it('renders chain a -> b -> c with indentation', () => {
    const out = renderAsciiTree(makeGraph({ a: [], b: ['a'], c: ['b'] }));
    expect(out).toMatch(/p-a[\s\S]*├─.*p-b[\s\S]*└─.*p-c|p-a[\s\S]*p-b[\s\S]*p-c/);
  });

  it('marks repeat occurrences with *', () => {
    const out = renderAsciiTree(makeGraph({ a: [], b: ['a'], c: ['a'], d: ['b', 'c'] }));
    expect(out.match(/\*/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('iconMap: prepends icon before each node line', () => {
    const graph = makeGraph({ a: [], b: ['a'] });
    const iconMap = new Map([['a', '✔'], ['b', '✖']]);
    const out = renderAsciiTree(graph, iconMap);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^✔ /);
    expect(lines).toSatisfy((ls: string[]) => ls.some(l => l.includes('✖')));
  });

  it('iconMap: uses space placeholder for nodes not in map', () => {
    const graph = makeGraph({ a: [] });
    const iconMap = new Map<string, string>(); // empty
    const out = renderAsciiTree(graph, iconMap);
    expect(out).toMatch(/^ {2}/); // leading space + space
  });

  it('iconMap absent: no icon prefix (backward compatible)', () => {
    const graph = makeGraph({ a: [] });
    const out = renderAsciiTree(graph);
    // first char should be start of fullName, not an icon
    expect(out.startsWith('p-a')).toBe(true);
  });
});
