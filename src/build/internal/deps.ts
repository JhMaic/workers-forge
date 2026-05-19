import { readFile } from 'node:fs/promises';

interface RawWranglerConfig {
  services?: Array<{ binding?: string; service?: string }>;
  durable_objects?: {
    bindings?: Array<{ name?: string; class_name?: string; script_name?: string }>;
  };
}

/**
 * Reads `<outputPath>` (a JSON file written by build()) and returns the local
 * module short names of its dependencies — both service bindings and Durable
 * Object cross-script bindings.
 *
 * Each `services[].service` and `durable_objects.bindings[].script_name`
 * value is a prefixed worker name (e.g. `immi-yoyaku-support-crawler`); we
 * strip `prefix` to get the local module name. A binding whose value does
 * NOT start with `prefix` is treated as an external worker and throws
 * (cross-deployment bindings can't be wired up by `wrangler dev`).
 */
export async function parseServiceDeps(
  outputPath: string,
  prefix: string,
  selfName: string,
): Promise<string[]> {
  const text = await readFile(outputPath, 'utf-8');
  const parsed = JSON.parse(text) as RawWranglerConfig;
  const out: string[] = [];
  const push = (target: string, label: string) => {
    if (!target.startsWith(prefix)) {
      throw new Error(
        `worker "${selfName}" depends on external ${label} "${target}" `
        + `(does not start with prefix "${prefix}")`,
      );
    }
    const local = target.slice(prefix.length);
    if (local !== selfName && !out.includes(local))
      out.push(local);
  };
  for (const svc of parsed.services ?? []) {
    if (svc.service)
      push(svc.service, 'service');
  }
  for (const b of parsed.durable_objects?.bindings ?? []) {
    if (b.script_name)
      push(b.script_name, 'durable_object script');
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
