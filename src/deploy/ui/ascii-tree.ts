import type { DeployGraph } from '../planner';

/**
 * Leaves = nodes with no deps. We render from leaves up through dependents.
 *
 * @param graph The deploy graph to render.
 * @param iconMap Optional map of node short name → icon string (e.g. '✔', '✖', '⠋').
 *   When provided, the icon is prepended before each node line, forming a status column
 *   to the left of the tree branches.
 */
export function renderAsciiTree(
  graph: DeployGraph,
  iconMap?: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const leaves = [...graph.nodes.values()].filter(n => n.deps.length === 0).map(n => n.name).sort();

  const walk = (name: string, prefix: string, isLast: boolean, depth: number): void => {
    const node = graph.nodes.get(name)!;
    const isRepeat = seen.has(name);
    const branch = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');
    const icon = iconMap != null ? `${iconMap.get(name) ?? ' '} ` : '';
    lines.push(`${icon}${prefix}${branch}${node.fullName}${isRepeat ? ' *' : ''}`);
    if (isRepeat)
      return;
    seen.add(name);
    const childPrefix = prefix + (depth === 0 ? '' : (isLast ? '   ' : '│  '));
    const deps = [...node.dependents].sort();
    deps.forEach((d, i) => walk(d, childPrefix, i === deps.length - 1, depth + 1));
  };

  leaves.forEach(r => walk(r, '', true, 0));
  return lines.join('\n');
}
