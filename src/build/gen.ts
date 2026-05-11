import type { WorkerMeta } from '../runtime/define';
import type { BaseConfig } from './base-config';
import type { EnvConfig } from './build';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WORKER_NAME_MAX_LEN, WORKER_NAME_REGEX } from '../runtime/constants';
import { getWorkerMeta, isDefinedWorker } from '../runtime/define';
import { envs } from '../runtime/envs';
import { defaultBaseConfig } from './base-config';
import { discoverModuleFiles } from './internal/discover';
import { readLayeredEnvFiles } from './internal/envfile';
import { ensureLoaderRegistered } from './internal/loader-register';
import { mergeWranglerConfig } from './internal/merge';
import { validateEnvs } from './internal/validate';

export interface GenOptions {
  /**
   * Path to a TS/JS file that named-exports `meta` (a `WorkerMeta` object,
   * typically authored with `defineWorkerMeta`). Resolved relative to `cwd`.
   */
  metaFile: string;
  /** Output path for the generated `wrangler.jsonc`. Resolved relative to `cwd`. */
  outFile: string;
  /** Working directory for path resolution. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Prefix prepended to the worker name. Defaults to `""` (no prefix). */
  prefix?: string;
  /** Shared wrangler fields merged in as the lowest-priority layer. */
  baseConfig?: BaseConfig;
  /**
   * Named environments. When `envName` is set, the matching entry's `envFile`
   * is layered into `process.env` (for `CF_CONFIG_*` keys) and overlaid onto
   * declared `vars`; the `suffix` is appended to the worker name.
   */
  envs?: readonly EnvConfig[];
  /** Active env name. Must match an entry in `envs`. */
  envName?: string;
  /**
   * Optional glob(s) of sibling worker modules in the same monorepo. When
   * provided, `gen` discovers each module's name and rewrites
   * `services[].service` entries that match a sibling name to the full
   * deployed name (`${prefix}${name}${suffix}`) — same behavior as
   * `workers-forge build`. Without this, you'd have to write
   * `${envs.prefix}name${envs.suffix}` manually inside the meta.
   */
  modules?: readonly string[];
}

export interface GenResult {
  /** Absolute path written. */
  outFile: string;
  /** The deployed worker name after prefix + suffix. */
  workerName: string;
}

export async function gen(opts: GenOptions): Promise<GenResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const prefix = opts.prefix ?? '';

  const envConfigErrors = validateEnvs(opts.envs);
  if (envConfigErrors.length > 0) {
    throw new Error(`Invalid envs configuration:\n${envConfigErrors.map(e => `  - ${e}`).join('\n')}`);
  }

  let activeEnv: { suffix: string; vars: Record<string, string> } | undefined;
  if (opts.envName) {
    if (!opts.envs || opts.envs.length === 0) {
      throw new Error(
        `--env "${opts.envName}" was passed but no \`envs\` are configured.`,
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
    activeEnv = { suffix: entry.suffix, vars: parsed.values };

    for (const [k, v] of Object.entries(activeEnv.vars)) {
      if (k.startsWith('CF_CONFIG_'))
        process.env[k] = v;
    }

    console.info(`🌱 Active env: ${entry.name}`, {
      envFile: envFilesAbs.map(p => relative(cwd, p)),
      suffix: entry.suffix,
      keys: Object.keys(parsed.values).length,
    });
  }

  // Seed build-time envs singleton BEFORE importing the meta — `defineWorkerMeta`
  // calls in the user's file may reference `envs.prefix` / `envs.suffix`.
  envs.suffix = activeEnv?.suffix ?? '';
  envs.prefix = prefix;

  // Discover sibling worker names from the monorepo's modules glob (if any).
  // A `service` field equal to a sibling name gets rewritten to the full
  // deployed name by mergeWranglerConfig — same as `workers-forge build`.
  const siblings = new Set<string>();
  if (opts.modules && opts.modules.length > 0) {
    ensureLoaderRegistered();
    const siblingFiles = await discoverModuleFiles({ cwd, modules: opts.modules });
    for (const file of siblingFiles) {
      let imported: { default?: unknown };
      try {
        imported = await import(pathToFileURL(file).href);
      }
      catch {
        // Skip modules that fail to import — they'd already error out under
        // `workers-forge build`. gen only needs their names for rewriting.
        continue;
      }
      if (isDefinedWorker(imported.default)) {
        const m = getWorkerMeta(imported.default);
        if (typeof m.name === 'string' && m.name.length > 0)
          siblings.add(m.name);
      }
    }
    if (siblings.size > 0) {
      console.info(`🔗 Discovered ${siblings.size} sibling worker(s)`, {
        names: [...siblings],
      });
    }
  }

  const metaFileAbs = isAbsolute(opts.metaFile) ? opts.metaFile : resolve(cwd, opts.metaFile);
  let imported: { meta?: unknown };
  try {
    imported = await import(pathToFileURL(metaFileAbs).href);
  }
  catch (err: any) {
    throw new Error(`Failed to import metaFile ${metaFileAbs}: ${err?.message ?? err}`);
  }
  if (imported.meta == null || typeof imported.meta !== 'object') {
    throw new Error(
      `metaFile ${metaFileAbs} must named-export "meta" (a WorkerMeta object). `
      + `Use defineWorkerMeta({ ... }) and \`export const meta = ...\`.`,
    );
  }
  const meta = imported.meta as WorkerMeta;
  if (typeof meta.name !== 'string' || meta.name.length === 0)
    throw new Error(`metaFile ${metaFileAbs}: meta.name must be a non-empty string`);
  if (!WORKER_NAME_REGEX.test(meta.name))
    throw new Error(`metaFile ${metaFileAbs}: meta.name must match ${WORKER_NAME_REGEX} (got "${meta.name}")`);

  const fullName = `${prefix}${meta.name}${activeEnv?.suffix ?? ''}`;
  if (!WORKER_NAME_REGEX.test(fullName))
    throw new Error(`Resolved worker name "${fullName}" must match ${WORKER_NAME_REGEX}`);
  if (fullName.length > WORKER_NAME_MAX_LEN)
    throw new Error(`Resolved worker name "${fullName}" length ${fullName.length} exceeds limit ${WORKER_NAME_MAX_LEN}`);

  const base = { ...defaultBaseConfig, ...opts.baseConfig } as BaseConfig;
  const merged = mergeWranglerConfig({
    moduleName: meta.name,
    prefix,
    // `sourcePath` is overwritten when meta._raw provides `main` (the standard
    // OpenNext case). For non-OpenNext gen users, the merge logic still writes
    // `main` from this value, so we point at the metaFile relative to outFile.
    sourcePath: '',
    meta,
    base,
    siblings,
    suffix: activeEnv?.suffix,
    varsOverrides: activeEnv?.vars,
  });

  const outFileAbs = isAbsolute(opts.outFile) ? opts.outFile : resolve(cwd, opts.outFile);
  await mkdir(dirname(outFileAbs), { recursive: true });
  await writeFile(outFileAbs, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');

  console.info(`✅ Generated ${relative(cwd, outFileAbs)}`, {
    worker: fullName,
  });

  return { outFile: outFileAbs, workerName: fullName };
}
