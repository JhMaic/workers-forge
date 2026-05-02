import type { DefinedWorker } from '../runtime/define';
import type { BaseConfig } from './base-config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WORKER_NAME_MAX_LEN, WORKER_NAME_REGEX } from '../runtime/constants';
import { getWorkerMeta } from '../runtime/define';
import { envs } from '../runtime/envs';
import { defaultBaseConfig } from './base-config';
import { discoverModuleFiles } from './internal/discover';
import { readEnvFile } from './internal/envfile';

import { mergeWranglerConfig } from './internal/merge';
import { validateEnvs, validateModule, validateRegistry } from './internal/validate';

const __dirname = dirname(fileURLToPath(import.meta.url));
let loaderRegistered = false;
function ensureLoaderRegistered(): void {
  if (loaderRegistered)
    return;
  try {
    register('./internal/loader.mjs', pathToFileURL(`${__dirname}/`));
    loaderRegistered = true;
  }
  catch (err) {
    console.warn('Failed to register cloudflare:* stub loader', { error: String(err) });
  }
}

export interface DevConfig {
  /**
   * Forwarded to `wrangler dev --persist-to`. Relative paths resolve against
   * the directory containing `cf-worker-kit.config.ts` (same rule as `outDir`).
   */
  persistTo?: string;
  /**
   * Per-module port overrides, keyed by module *short name* (the directory
   * under `outDir`, i.e. the segment between the prefix and the path — e.g.
   * `crawler` for `<outDir>/crawler/wrangler.jsonc`). Modules without an
   * override get a randomly assigned free port at dev-time.
   */
  ports?: Readonly<Record<string, number>>;
}

export interface EnvConfig {
  /** Selector used by `--env <name>`. Must be unique across `envs`. */
  name: string;
  /**
   * Path to a dotenv-style file. Resolved relative to the directory containing
   * `cf-worker-kit.config.ts` (same rule as `outDir`). Absolute paths used as-is.
   */
  envFile: string;
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
}

export interface BuildResult {
  deployed: string[];
  outputs: string[];
}

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
        `--env "${opts.envName}" was passed but no \`envs\` are configured in cf-worker-kit.config.`,
      );
    }
    const entry = opts.envs.find(e => e.name === opts.envName);
    if (!entry) {
      const available = opts.envs.map(e => e.name).join(', ');
      throw new Error(`Unknown env "${opts.envName}". Available envs: ${available}.`);
    }
    const envFileAbs = resolve(cwd, entry.envFile);
    let parsed;
    try {
      parsed = await readEnvFile(envFileAbs);
    }
    catch (err: any) {
      throw new Error(`Failed to read envFile for env "${entry.name}" at ${envFileAbs}: ${err?.message ?? err}`);
    }
    const resolvedSuffix = entry.suffix;
    activeEnv = { suffix: resolvedSuffix, vars: parsed.values };
    console.info(`🌱 Active env: ${entry.name}`, {
      envFile: relative(cwd, envFileAbs),
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
  const valid: { file: string; worker: DefinedWorker }[] = [];

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
    if (result.ok)
      valid.push({ file, worker: imported.default as DefinedWorker });
    else
      errors.push(...result.errors);
  }

  errors.push(...validateRegistry(valid));

  if (activeEnv) {
    for (const { file, worker } of valid) {
      const meta = getWorkerMeta(worker);
      const fullName = `${opts.prefix}${meta.name}${activeEnv.suffix}`;
      if (!WORKER_NAME_REGEX.test(fullName)) {
        errors.push(
          `${relative(cwd, file)}: env-suffixed worker name "${fullName}" must match `
          + `${WORKER_NAME_REGEX}`,
        );
      }
      else if (fullName.length > WORKER_NAME_MAX_LEN) {
        errors.push(
          `${relative(cwd, file)}: env-suffixed worker name "${fullName}" length `
          + `${fullName.length} exceeds limit ${WORKER_NAME_MAX_LEN}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('Validation failed', { errors });
    throw new Error(`Validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const outputs: string[] = [];
  const deployed: string[] = [];
  const siblings = new Set(valid.map(v => getWorkerMeta(v.worker).name));

  for (const { file, worker } of valid) {
    const meta = getWorkerMeta(worker);
    const moduleOutDir = join(outDir, meta.name);
    await mkdir(moduleOutDir, { recursive: true });
    const outFile = join(moduleOutDir, 'wrangler.jsonc');
    const sourceRel = relative(moduleOutDir, file).replaceAll('\\', '/');

    const merged = mergeWranglerConfig({
      moduleName: meta.name,
      prefix: opts.prefix,
      sourcePath: sourceRel,
      meta,
      base,
      siblings,
      suffix: activeEnv?.suffix,
      varsOverrides: activeEnv?.vars,
    });

    await writeFile(outFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
    outputs.push(outFile);
    deployed.push(meta.name);
  }

  console.info(`✅ Generated ${outputs.length} wrangler config(s)`, {
    outputs: outputs.map(f => relative(cwd, f)),
  });

  return { deployed, outputs };
}
