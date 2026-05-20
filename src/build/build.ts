import type { DefinedWorker, WorkerMeta } from '../runtime/define';
import type { DefinedDurableObject, DurableObjectMeta } from '../runtime/durable-object';
import type { BaseConfig } from './base-config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WORKER_NAME_MAX_LEN, WORKER_NAME_REGEX } from '../runtime/constants';
import { getWorkerMeta } from '../runtime/define';
import { getDurableObjectMeta } from '../runtime/durable-object';
import { envs } from '../runtime/envs';
import { defaultBaseConfig } from './base-config';
import { deriveClassName } from './internal/derive-class-name';
import { discoverModuleFiles } from './internal/discover';
import { readLayeredEnvFiles } from './internal/envfile';
import { ensureLoaderRegistered } from './internal/loader-register';

import { mergeWranglerConfig } from './internal/merge';
import { validateEnvs, validateModule, validateRegistry } from './internal/validate';

export interface DevConfig {
  /**
   * Forwarded to `wrangler dev --persist-to`. Relative paths resolve against
   * the directory containing `workers-forge.config.ts` (same rule as `outDir`).
   */
  persistTo?: string;
  /**
   * Fixed port overrides for the primary `wrangler dev` process of each
   * "spawn unit". Keys are either:
   *   - a module *short name* (the directory under `outDir`, e.g. `crawler`
   *     for `<outDir>/crawler/wrangler.jsonc`), for workers NOT inside any
   *     `dev.groups` entry; or
   *   - a *group name* declared in `dev.groups`, in which case the port is
   *     applied to that group's merged `wrangler dev` invocation.
   *
   * Units without an override get a randomly assigned free port at dev-time.
   * Referencing a worker that lives inside a group is rejected — use the
   * group name instead.
   */
  ports?: Readonly<Record<string, number>>;
  /**
   * Co-host multiple workers in a single `wrangler dev` process by listing
   * their short names under a group key:
   *
   *   dev: {
   *     groups: { 'queue-stack': ['producer', 'consumer-a', 'consumer-b'] },
   *     ports:  { 'queue-stack': 8787 },
   *   }
   *
   * The kit will launch one merged child:
   *   `wrangler dev -c producer/wrangler.jsonc -c consumer-a/wrangler.jsonc …`
   *
   * Useful for queue producer/consumer pairs and other workloads that need
   * to share a single dev session so bindings resolve in-process.
   *
   * Rules:
   *   - The first listed worker is the primary (first `-c`).
   *   - Group name is used as the log label and as the `dev.ports` key.
   *   - A worker may belong to at most one group.
   *   - Group names must not collide with any worker short name.
   *   - Workers not listed in any group continue to spawn individually.
   */
  groups?: Readonly<Record<string, readonly string[]>>;
}

export interface EnvConfig {
  /** Selector used by `--env <name>`. Must be unique across `envs`. */
  name: string;
  /**
   * Path(s) to dotenv-style file(s). When an array, files are layered in order
   * with **later entries overriding earlier ones** (so put more-specific files
   * after more-generic ones, e.g. `['.env', '.env.staging', '.env.staging.local']`).
   * Relative paths resolve against the directory containing `workers-forge.config.ts`
   * (same rule as `outDir`). Absolute paths are used as-is.
   */
  envFile: string | readonly string[];
  /**
   * Appended verbatim to every generated worker name:
   *   `${prefix}${meta.name}${suffix}`
   *
   * The same suffix is applied to sibling service-binding `service` fields so
   * env-isolated deploys route only to their same-env siblings.
   *
   * Use `""` for no suffix (workers keep their base names).
   * Include any desired separator in the value — the kit inserts nothing:
   *   `"-staging"` → `pfx-worker-staging`
   *   `""` → `pfx-worker`
   *
   * When non-empty, must match `[a-z0-9-]+` and the resulting full worker name
   * must not exceed 63 characters.
   */
  suffix: string;
}

export interface BuildOptions {
  cwd?: string;
  modules?: readonly string[];
  outDir?: string;
  prefix: string;
  baseConfig?: BaseConfig;
  dev?: DevConfig;
  /**
   * Optional named environments. When the user runs `deploy --env <name>` or
   * `dev --env <name>`, the matching entry's `envFile` is parsed and overlays
   * onto declared `vars`, and the `suffix` is appended to worker names.
   *
   * `build` itself does not accept `--env` (env is owned by deploy/dev).
   */
  envs?: readonly EnvConfig[];
}

// Populated by deploy/dev when forwarding `--env <name>` to build().
// Not exposed via `defineConfig`.
export interface InternalBuildOptions extends BuildOptions {
  envName?: string;
  /**
   * If provided and non-empty, only the listed module short names (without
   * prefix) are built. Other workers' existing outputs are left untouched.
   * Empty or omitted = build all discovered modules (default behavior).
   */
  only?: readonly string[];
}

export interface BuildResult {
  deployed: string[];
  outputs: string[];
}

type ValidEntry
  = | { kind: 'worker'; file: string; value: DefinedWorker; meta: WorkerMeta }
    | { kind: 'durable_object'; file: string; value: DefinedDurableObject; meta: DurableObjectMeta };

const DEFAULT_MODULES = [
  'src/modules/**/index.ts',
  '!**/_*/**',
  '!**/__tests__/**',
];

export async function build(opts: InternalBuildOptions): Promise<BuildResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const outDir = resolve(cwd, opts.outDir ?? '.build');
  const modules = opts.modules ?? DEFAULT_MODULES;
  const base = { ...defaultBaseConfig, ...opts.baseConfig } as BaseConfig;

  const envConfigErrors = validateEnvs(opts.envs);
  if (envConfigErrors.length > 0) {
    console.error('Invalid envs configuration', { errors: envConfigErrors });
    throw new Error(`Invalid envs configuration:\n${envConfigErrors.map(e => `  - ${e}`).join('\n')}`);
  }

  let activeEnv: { suffix: string; vars: Record<string, string> } | undefined;
  if (opts.envName) {
    if (!opts.envs || opts.envs.length === 0) {
      throw new Error(
        `--env "${opts.envName}" was passed but no \`envs\` are configured in workers-forge.config.`,
      );
    }
    const entry = opts.envs.find(e => e.name === opts.envName);
    if (!entry) {
      const available = opts.envs.map(e => e.name).join(', ');
      throw new Error(`Unknown env "${opts.envName}". Available envs: ${available}.`);
    }
    const envFiles = Array.isArray(entry.envFile) ? entry.envFile : [entry.envFile as string];
    const envFilesAbs = envFiles.map(p => resolve(cwd, p));
    let parsed;
    try {
      parsed = await readLayeredEnvFiles(envFilesAbs);
    }
    catch (err: any) {
      throw new Error(`Failed to read envFile for env "${entry.name}" (${envFilesAbs.join(', ')}): ${err?.message ?? err}`);
    }
    const resolvedSuffix = entry.suffix;
    activeEnv = { suffix: resolvedSuffix, vars: parsed.values };
    console.info(`🌱 Active env: ${entry.name}`, {
      envFile: envFilesAbs.map(p => relative(cwd, p)),
      suffix: resolvedSuffix,
      keys: Object.keys(parsed.values).length,
    });

    for (const [k, v] of Object.entries(activeEnv.vars)) {
      if (k.startsWith('CF_CONFIG_'))
        process.env[k] = v;
    }
  }

  // Expose build-time env context to worker modules via the envs singleton.
  // Must be set before any worker module is import()ed.
  envs.suffix = activeEnv?.suffix ?? '';
  envs.prefix = opts.prefix;

  console.info('🔍 Scanning modules', { cwd, modules });
  ensureLoaderRegistered();
  const files = await discoverModuleFiles({ cwd, modules });

  if (files.length === 0) {
    console.info('No modules found. Cleaning output dir.');
    await rm(outDir, { recursive: true, force: true });
    return { deployed: [], outputs: [] };
  }

  console.info(`Found ${files.length} module file(s)`, {
    files: files.map(f => relative(cwd, f)),
  });

  const errors: string[] = [];
  const valid: ValidEntry[] = [];

  for (const file of files) {
    let imported: { default?: unknown };
    try {
      imported = await import(pathToFileURL(file).href);
    }
    catch (err: any) {
      errors.push(`${relative(cwd, file)}: failed to import — ${err?.message ?? err}`);
      continue;
    }
    const result = validateModule(relative(cwd, file), imported.default, opts.prefix);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    if (result.kind === 'worker') {
      valid.push({
        kind: 'worker',
        file,
        value: imported.default as DefinedWorker,
        meta: getWorkerMeta(imported.default as DefinedWorker),
      });
    }
    else {
      valid.push({
        kind: 'durable_object',
        file,
        value: imported.default as DefinedDurableObject,
        meta: getDurableObjectMeta(imported.default as DefinedDurableObject),
      });
    }
  }

  errors.push(...validateRegistry(valid));

  if (activeEnv) {
    for (const v of valid) {
      const fullName = `${opts.prefix}${v.meta.name}${activeEnv.suffix}`;
      if (!WORKER_NAME_REGEX.test(fullName)) {
        errors.push(
          `${relative(cwd, v.file)}: env-suffixed worker name "${fullName}" must match `
          + `${WORKER_NAME_REGEX}`,
        );
      }
      else if (fullName.length > WORKER_NAME_MAX_LEN) {
        errors.push(
          `${relative(cwd, v.file)}: env-suffixed worker name "${fullName}" length `
          + `${fullName.length} exceeds limit ${WORKER_NAME_MAX_LEN}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('Validation failed', { errors });
    throw new Error(`Validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  // siblings must be computed from ALL valid modules so cross-binding rewrites
  // refer to the full deployed set, even when --app limits what gets generated.
  const siblings = new Set(valid.map(v => v.meta.name));

  let toGenerate = valid;
  if (opts.only && opts.only.length > 0) {
    for (const name of opts.only) {
      if (!siblings.has(name)) {
        const available = [...siblings].join(', ') || '(none)';
        throw new Error(`Unknown module "${name}" passed to --app. Available: ${available}.`);
      }
    }
    const requested = new Set(opts.only);
    toGenerate = valid.filter(v => requested.has(v.meta.name));
  }

  // Selective build: preserve other workers' output; only refresh the requested
  // subdirectories. Full build: wipe outDir to remove stale configs.
  if (toGenerate.length === valid.length) {
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  const outputs: string[] = [];
  const deployed: string[] = [];

  for (const v of toGenerate) {
    const moduleOutDir = join(outDir, v.meta.name);
    await rm(moduleOutDir, { recursive: true, force: true });
    await mkdir(moduleOutDir, { recursive: true });
    const outFile = join(moduleOutDir, 'wrangler.jsonc');
    const sourceRel = relative(moduleOutDir, v.file).replaceAll('\\', '/');

    let mainPath: string;
    if (v.kind === 'durable_object') {
      // Cloudflare resolves a DO class by `class_name` in the host script's
      // bundle exports. The user's module only has a `default` export, so we
      // emit a barrel that re-exports it under the derived PascalCase name and
      // adds a no-op 405 fetch handler (Cloudflare requires at least one event
      // handler per script).
      const className = deriveClassName(v.meta.name);
      const entryPath = join(moduleOutDir, 'entry.ts');
      const entrySrc
        = `export { default as ${className} } from '${stripExt(sourceRel)}';\n`
          + `export default { fetch: () => new Response(null, { status: 405 }) };\n`;
      await writeFile(entryPath, entrySrc, 'utf-8');
      mainPath = 'entry.ts';
    }
    else {
      mainPath = sourceRel;
    }

    const merged = mergeWranglerConfig({
      moduleName: v.meta.name,
      prefix: opts.prefix,
      sourcePath: mainPath,
      meta: v.meta,
      kind: v.kind,
      base,
      siblings,
      suffix: activeEnv?.suffix,
      varsOverrides: activeEnv?.vars,
    });

    await writeFile(outFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
    outputs.push(outFile);
    deployed.push(v.meta.name);
  }

  console.info(`✅ Generated ${outputs.length} wrangler config(s)`, {
    outputs: outputs.map(f => relative(cwd, f)),
  });

  return { deployed, outputs };
}

function stripExt(p: string): string {
  return p.replace(/\.tsx?$/u, '').replace(/\.[mc]?js$/u, '');
}
