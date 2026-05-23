import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { deriveClassName } from '../build/internal/derive-class-name';

/**
 * Pure-I/O analysis of the kit's `<outDir>/` for a given worker target. Returns
 * absolute paths to the main + sibling wrangler configs plus a self-binding
 * descriptor when the target is a Durable Object host script.
 *
 * `defineVitestProject` consumes this and uses
 * `wrangler.unstable_getMiniflareWorkerOptions` (which handles TS bundling and
 * binding translation) to turn each sibling config path into a real miniflare
 * WorkerOptions.
 */
export interface PoolOptionsDescriptor {
  /** Absolute path to the main worker's `wrangler.jsonc`. */
  mainConfigPath: string;
  /** Siblings referenced by the main worker, paired with their deployed name. */
  siblings: { configPath: string; deployedName: string }[];
  /**
   * If the worker under test is a DO host, the synthesized self-binding to
   * inject into miniflare's main-worker durableObjects so tests can grab a
   * stub via `env.<BINDING>.get(...)`. Undefined for regular workers.
   */
  selfDurableObjectBinding?: { binding: string; className: string };
}

interface BuiltWranglerConfig {
  name: string;
  main?: string;
  services?: { binding: string; service: string }[];
  durable_objects?: {
    bindings: { name: string; class_name: string; script_name?: string }[];
  };
  migrations?: { tag: string; new_sqlite_classes?: string[]; new_classes?: string[] }[];
}

export interface BuildPoolOptionsArgs {
  /** Resolved absolute path of `<outDir>/`. */
  outDir: string;
  /** Short name of the worker under test (the directory under `outDir`). */
  worker: string;
}

/**
 * Inspect `<outDir>/` for the worker under test and any siblings it references
 * via service bindings or Durable Object `script_name`. Returns the paths a
 * caller needs to feed to wrangler's miniflare-options bridge.
 */
export async function buildPoolOptions(args: BuildPoolOptionsArgs): Promise<PoolOptionsDescriptor> {
  const { outDir, worker } = args;

  const mainConfigPath = resolve(outDir, worker, 'wrangler.jsonc');
  if (!existsSync(mainConfigPath)) {
    throw new Error(
      `[workers-forge/testing] Missing ${relative(process.cwd(), mainConfigPath)}.\n`
      + `Run \`workers-forge build\` (with --env if your KitConfig uses envs) before launching vitest.`,
    );
  }

  const siblingConfigs = await discoverSiblings(outDir);
  const mainCfg = siblingConfigs.get(worker);
  if (!mainCfg) {
    throw new Error(
      `[workers-forge/testing] Worker "${worker}" not found in ${relative(process.cwd(), outDir)}.`,
    );
  }

  const deployedToShort = new Map<string, string>();
  for (const [short, cfg] of siblingConfigs)
    deployedToShort.set(cfg.name, short);

  const referencedSiblings = new Set<string>();
  for (const s of mainCfg.services ?? []) {
    const short = deployedToShort.get(s.service);
    if (short !== undefined && short !== worker) referencedSiblings.add(short);
  }
  for (const d of mainCfg.durable_objects?.bindings ?? []) {
    if (!d.script_name) continue;
    const short = deployedToShort.get(d.script_name);
    if (short !== undefined && short !== worker) referencedSiblings.add(short);
  }

  const siblings = [...referencedSiblings].map(s => ({
    configPath: resolve(outDir, s, 'wrangler.jsonc'),
    deployedName: siblingConfigs.get(s)!.name,
  }));

  const descriptor: PoolOptionsDescriptor = {
    mainConfigPath,
    siblings,
  };

  if (isDurableObjectHost(mainCfg)) {
    const className = deriveClassName(worker);
    descriptor.selfDurableObjectBinding = {
      binding: className.toUpperCase(),
      className,
    };
  }

  return descriptor;
}

function isDurableObjectHost(cfg: BuiltWranglerConfig): boolean {
  return (cfg.migrations ?? []).some(
    m => (m.new_sqlite_classes && m.new_sqlite_classes.length > 0)
      || (m.new_classes && m.new_classes.length > 0),
  );
}

async function discoverSiblings(outDir: string): Promise<Map<string, BuiltWranglerConfig>> {
  const out = new Map<string, BuiltWranglerConfig>();
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await readdir(outDir, { withFileTypes: true });
  }
  catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const cfgPath = resolve(outDir, ent.name, 'wrangler.jsonc');
    if (!existsSync(cfgPath)) continue;
    try {
      const raw = await readFile(cfgPath, 'utf-8');
      out.set(ent.name, JSON.parse(raw) as BuiltWranglerConfig);
    }
    catch {
      // skip unparseable configs
    }
  }
  return out;
}
