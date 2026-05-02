import { readFile } from 'node:fs/promises';

interface RawWranglerConfig {
  services?: Array<{ binding?: string; service?: string }>;
}

/**
 * Reads `<outputPath>` (a JSON file written by build()) and returns the local
 * module short names of its service-binding dependencies.
 *
 * Each `services[].service` value is the prefixed worker name (e.g.
 * `immi-yoyaku-support-crawler`); we strip `prefix` to get the local module
 * name. A binding whose `service` value does NOT start with `prefix` is
 * treated as an external worker and throws (cross-deployment service
 * bindings can't be wired up by `wrangler dev`).
 */
export async function parseServiceDeps(
  outputPath: string,
  prefix: string,
  selfName: string,
): Promise<string[]> {
  const text = await readFile(outputPath, 'utf-8');
  const parsed = JSON.parse(text) as RawWranglerConfig;
  const out: string[] = [];
  for (const svc of parsed.services ?? []) {
    if (!svc.service)
      continue;
    if (!svc.service.startsWith(prefix)) {
      throw new Error(
        `worker "${selfName}" depends on external service "${svc.service}" `
        + `(does not start with prefix "${prefix}")`,
      );
    }
    const local = svc.service.slice(prefix.length);
    if (local !== selfName)
      out.push(local);
  }
  return out;
}

export interface ResolveResult {
  /** Closure of roots ∪ deps, sorted topologically: leaves first. */
  order: string[];
}

/**
 * DFS from `roots`, accumulate the closure under `depsByName`. Leaves-first
 * topological order. Throws on cycle (with path) or unknown dep.
 */
export function resolveClosure(
  roots: readonly string[],
  depsByName: ReadonlyMap<string, readonly string[]>,
): ResolveResult {
  const known = new Set(depsByName.keys());
  for (const r of roots) {
    if (!known.has(r)) {
      throw new Error(
        `unknown worker "${r}" (known: ${[...known].sort().join(', ')})`,
      );
    }
  }
  const order: string[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  const visit = (name: string) => {
    if (seen.has(name))
      return;
    if (visiting.has(name)) {
      const cycleStart = path.indexOf(name);
      const cyclePath = [...path.slice(cycleStart), name].join(' → ');
      throw new Error(`cycle detected: ${cyclePath}`);
    }
    visiting.add(name);
    path.push(name);
    const deps = depsByName.get(name);
    if (deps === undefined) {
      throw new Error(
        `unknown worker "${name}" referenced as dep `
        + `(known: ${[...known].sort().join(', ')})`,
      );
    }
    for (const d of deps) visit(d);
    visiting.delete(name);
    path.pop();
    seen.add(name);
    order.push(name);
  };

  for (const r of roots) visit(r);
  return { order };
}
