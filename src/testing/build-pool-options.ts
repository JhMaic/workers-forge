import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { deriveClassName } from '../build/internal/derive-class-name';

/**
 * Synthesized options for the `@cloudflare/vitest-pool-workers`
 * `cloudflareTest({...})` plugin. The kit deliberately avoids importing
 * pool-workers types statically so users without the testing helper installed
 * still see clean type errors. The plugin itself enforces shape at use site.
 */
export interface SynthesizedPoolOptions {
  wrangler: { configPath: string };
  miniflare: {
    workers?: MiniflareAuxWorker[];
    durableObjects?: Record<string, string | { className: string; scriptName?: string }>;
  };
}

interface MiniflareAuxWorker {
  name: string;
  modules: true;
  modulesRoot: string;
  scriptPath: string;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  durableObjects?: Record<string, string | { className: string; scriptName?: string }>;
  serviceBindings?: Record<string, string>;
  kvNamespaces?: Record<string, string>;
  r2Buckets?: Record<string, string>;
  bindings?: Record<string, string>;
  queueProducers?: Record<string, string>;
}

interface BuiltWranglerConfig {
  name: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  vars?: Record<string, string>;
  kv_namespaces?: { binding: string; id: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  services?: { binding: string; service: string }[];
  durable_objects?: {
    bindings: { name: string; class_name: string; script_name?: string }[];
  };
  queues?: {
    producers?: { binding: string; queue: string }[];
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
 * Synthesize pool-workers options from the kit's already-generated wrangler
 * configs in `<outDir>/`. Pure I/O — reads JSON files, returns an object. No
 * vitest / pool-workers imports here, so unit tests can exercise it directly.
 *
 * Discovers sibling workers by scanning `<outDir>/<short>/wrangler.jsonc`,
 * then maps each `services[].service` / `durable_objects.bindings[].script_name`
 * in the main worker back to a sibling and emits it as an auxiliary
 * miniflare worker.
 *
 * If the worker under test is a Durable Object host (its wrangler.jsonc has a
 * `migrations[].new_sqlite_classes` / `new_classes` entry), the helper
 * auto-injects a same-isolate self-binding so tests can grab a stub via
 * `env.<CLASS>` without the user adding a DO binding to their meta.
 */
export async function buildPoolOptions(args: BuildPoolOptionsArgs): Promise<SynthesizedPoolOptions> {
  const { outDir, worker } = args;

  const mainConfigPath = resolve(outDir, worker, 'wrangler.jsonc');
  if (!existsSync(mainConfigPath)) {
    throw new Error(
      `[workers-forge/testing] Missing ${relative(process.cwd(), mainConfigPath)}.\n`
      + `Run \`workers-forge build\` (with --env if your KitConfig uses envs) before launching vitest.`,
    );
  }

  // Discover all sibling wrangler configs by scanning outDir
  const siblingConfigs = await discoverSiblings(outDir);
  const mainCfg = siblingConfigs.get(worker);
  if (!mainCfg) {
    throw new Error(
      `[workers-forge/testing] Worker "${worker}" not found in ${relative(process.cwd(), outDir)}.`,
    );
  }

  // Build the reverse map: deployed name → short name
  const deployedToShort = new Map<string, string>();
  for (const [short, cfg] of siblingConfigs)
    deployedToShort.set(cfg.name, short);

  // Identify referenced siblings via the main worker's bindings
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

  const auxWorkers: MiniflareAuxWorker[] = [];
  for (const sibShort of referencedSiblings) {
    const sibCfg = siblingConfigs.get(sibShort)!;
    const sibDir = resolve(outDir, sibShort);
    auxWorkers.push(toAuxWorker(sibCfg, sibDir));
  }

  const miniflare: SynthesizedPoolOptions['miniflare'] = {};
  if (auxWorkers.length > 0) miniflare.workers = auxWorkers;

  // DO modules: their own wrangler has no DO binding, just migrations. Inject
  // a self-binding so the test can do env.<CLASS>.get(...).<method>().
  if (isDurableObjectHost(mainCfg)) {
    const className = deriveClassName(worker);
    miniflare.durableObjects = {
      [className.toUpperCase()]: className,
    };
  }

  return {
    wrangler: { configPath: mainConfigPath },
    miniflare,
  };
}

/** True when this wrangler.jsonc was generated for a `defineDurableObject` module. */
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
      // skip unparseable configs; they'd surface elsewhere too
    }
  }
  return out;
}

/**
 * Map a kit-generated wrangler.jsonc to a miniflare auxiliary WorkerOptions.
 * Used to wire sibling workers into the test isolate's miniflare instance so
 * service bindings and DO script_name references resolve in-process.
 */
function toAuxWorker(cfg: BuiltWranglerConfig, modulesRoot: string): MiniflareAuxWorker {
  const main = cfg.main;
  if (!main)
    throw new Error(`[workers-forge/testing] sibling wrangler.jsonc has no "main": ${cfg.name}`);
  const scriptPath = isAbsolute(main) ? main : resolve(modulesRoot, main);

  const w: MiniflareAuxWorker = {
    name: cfg.name,
    modules: true,
    modulesRoot,
    scriptPath,
  };
  if (cfg.compatibility_date) w.compatibilityDate = cfg.compatibility_date;
  if (cfg.compatibility_flags && cfg.compatibility_flags.length > 0)
    w.compatibilityFlags = [...cfg.compatibility_flags];

  if (cfg.durable_objects?.bindings && cfg.durable_objects.bindings.length > 0) {
    const out: Record<string, string | { className: string; scriptName?: string }> = {};
    for (const b of cfg.durable_objects.bindings) {
      out[b.name] = b.script_name && b.script_name !== cfg.name
        ? { className: b.class_name, scriptName: b.script_name }
        : b.class_name;
    }
    w.durableObjects = out;
  }

  if (cfg.services && cfg.services.length > 0) {
    const out: Record<string, string> = {};
    for (const s of cfg.services) out[s.binding] = s.service;
    w.serviceBindings = out;
  }

  if (cfg.kv_namespaces && cfg.kv_namespaces.length > 0) {
    const out: Record<string, string> = {};
    for (const k of cfg.kv_namespaces) out[k.binding] = k.id;
    w.kvNamespaces = out;
  }

  if (cfg.r2_buckets && cfg.r2_buckets.length > 0) {
    const out: Record<string, string> = {};
    for (const r of cfg.r2_buckets) out[r.binding] = r.bucket_name;
    w.r2Buckets = out;
  }

  if (cfg.vars && Object.keys(cfg.vars).length > 0)
    w.bindings = { ...cfg.vars };

  if (cfg.queues?.producers && cfg.queues.producers.length > 0) {
    const out: Record<string, string> = {};
    for (const q of cfg.queues.producers) out[q.binding] = q.queue;
    w.queueProducers = out;
  }

  return w;
}
