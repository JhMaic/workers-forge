import { readFile } from 'node:fs/promises';
import { resolveClosure } from '../build/internal/deps';
import { moduleNameFromOutput } from '../build/internal/log-prefix';

export interface DeployNode {
  name: string; // short name (without prefix or env suffix)
  fullName: string; // value from wrangler.jsonc `name`
  configPath: string; // absolute path to wrangler.jsonc
  deps: string[]; // local short names (dedup, externals stripped)
  dependents: string[]; // reverse edges
}

export interface DeployGraph {
  nodes: ReadonlyMap<string, DeployNode>;
  /** Topological order (leaves first); used for ASCII tree + verbose runner stable output. */
  order: string[];
}

interface RawCfg {
  name?: string;
  services?: Array<{ binding?: string; service?: string }>;
  durable_objects?: {
    bindings?: Array<{ name?: string; class_name?: string; script_name?: string }>;
  };
}

export async function loadGraph(outputs: readonly string[], prefix: string): Promise<DeployGraph> {
  const parsed = await Promise.all(outputs.map(async (cfgPath) => {
    const text = await readFile(cfgPath, 'utf-8');
    const cfg = JSON.parse(text) as RawCfg;
    if (!cfg.name)
      throw new Error(`wrangler.jsonc at "${cfgPath}" is missing required "name" field`);
    return { name: moduleNameFromOutput(cfgPath), fullName: cfg.name, cfg, cfgPath };
  }));

  const fullToShort = new Map(parsed.map(p => [p.fullName, p.name]));

  const depsByName = new Map<string, string[]>();
  for (const p of parsed) {
    const deps: string[] = [];
    const addDep = (target: string, kind: string) => {
      const depShort = fullToShort.get(target);
      if (!depShort || depShort === p.name) {
        if (target.startsWith(prefix) && !fullToShort.has(target))
          console.warn(`[workers-forge] deploy: ${kind} "${target}" has prefix "${prefix}" but was not found in build outputs — ignored for ordering (typo?)`);
        return;
      }
      if (!deps.includes(depShort))
        deps.push(depShort);
    };
    for (const svc of p.cfg.services ?? []) {
      if (svc.service)
        addDep(svc.service, 'service');
    }
    for (const b of p.cfg.durable_objects?.bindings ?? []) {
      if (b.script_name)
        addDep(b.script_name, 'durable_object script');
    }
    depsByName.set(p.name, deps);
  }

  const { order } = resolveClosure([...depsByName.keys()], depsByName);

  const dependentsByName = new Map<string, string[]>();
  for (const p of parsed) dependentsByName.set(p.name, []);
  for (const [name, deps] of depsByName) {
    for (const d of deps) dependentsByName.get(d)!.push(name);
  }

  const nodes = new Map<string, DeployNode>();
  for (const p of parsed) {
    nodes.set(p.name, {
      name: p.name,
      fullName: p.fullName,
      configPath: p.cfgPath,
      deps: depsByName.get(p.name)!,
      dependents: dependentsByName.get(p.name)!,
    });
  }
  return { nodes, order };
}
