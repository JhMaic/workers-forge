import type { DefinedWorker, WorkerMeta } from '../../runtime/define';
import type { EnvConfig } from '../build';
import { moduleNameMaxLen, WORKER_NAME_REGEX } from '../../runtime/constants';
import { getWorkerMeta, isDefinedWorker } from '../../runtime/define';

export type ValidationResult
  = | { ok: true; meta: WorkerMeta }
    | { ok: false; errors: string[] };

export function validateModule(
  file: string,
  defaultExport: unknown,
  prefix: string,
): ValidationResult {
  const errors: string[] = [];

  if (!isDefinedWorker(defaultExport)) {
    return {
      ok: false,
      errors: [`${file}: default export is not a defineWorker() product`],
    };
  }

  const meta = getWorkerMeta(defaultExport);
  const maxLen = moduleNameMaxLen(prefix);

  if (typeof meta.name !== 'string' || meta.name.length === 0) {
    errors.push(`${file}: meta.name must be a non-empty string`);
  }
  else if (!WORKER_NAME_REGEX.test(meta.name)) {
    errors.push(`${file}: meta.name must match ${WORKER_NAME_REGEX} (got "${meta.name}")`);
  }
  else if (meta.name.length > maxLen) {
    errors.push(
      `${file}: meta.name length ${meta.name.length} exceeds limit ${maxLen} `
      + `(deployed name "${prefix}${meta.name}" must be ≤ 63 chars)`,
    );
  }

  if (meta.triggers?.cron !== undefined) {
    const cron = meta.triggers.cron;
    const isValidCron = typeof cron === 'string'
      || (Array.isArray(cron) && cron.every(c => typeof c === 'string'));
    if (!isValidCron)
      errors.push(`${file}: triggers.cron must be string or string[]`);
  }

  if (meta.triggers?.queue && !Array.isArray(meta.triggers.queue.consumers))
    errors.push(`${file}: triggers.queue.consumers must be an array`);

  if (meta.triggers?.tail && !Array.isArray(meta.triggers.tail.producers))
    errors.push(`${file}: triggers.tail.producers must be an array`);

  if (errors.length > 0)
    return { ok: false, errors };
  return { ok: true, meta };
}

export interface RegistryEntry {
  file: string;
  worker: DefinedWorker;
}

export function validateRegistry(entries: readonly RegistryEntry[]): string[] {
  const errors: string[] = [];
  const byName = new Map<string, string>();

  for (const { file, worker } of entries) {
    const meta = getWorkerMeta(worker);
    const prev = byName.get(meta.name);
    if (prev)
      errors.push(`Duplicate worker name "${meta.name}": ${prev} and ${file}`);
    else
      byName.set(meta.name, file);
  }

  const known = new Set(byName.keys());
  for (const { file, worker } of entries) {
    const meta = getWorkerMeta(worker);
    for (const [binding, svc] of Object.entries(meta.bindings?.services ?? {})) {
      if (!known.has(svc.service)) {
        errors.push(
          `${file}: service binding "${binding}" references unknown worker `
          + `"${svc.service}" (not declared by any module in this build)`,
        );
      }
    }
  }

  return errors;
}

/**
 * Validates the shape of the optional `envs` array in `KitConfig`. Pure shape
 * checks — does not touch the filesystem; envFile existence is checked lazily
 * by `build()` only when `--env` actually selects an entry.
 */
export function validateEnvs(envs: readonly EnvConfig[] | undefined): string[] {
  if (!envs)
    return [];
  const errors: string[] = [];
  if (!Array.isArray(envs)) {
    errors.push('envs must be an array');
    return errors;
  }
  const seen = new Set<string>();
  envs.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`envs[${idx}]: must be an object with { name, envFile, suffix }`);
      return;
    }
    const { name, envFile, suffix } = entry;
    if (typeof name !== 'string' || name.length === 0) {
      errors.push(`envs[${idx}].name: must be a non-empty string`);
    }
    else if (seen.has(name)) {
      errors.push(`envs[${idx}].name: duplicate env name "${name}"`);
    }
    else {
      seen.add(name);
    }

    if (typeof envFile === 'string') {
      if (envFile.length === 0)
        errors.push(`envs[${idx}].envFile: must be a non-empty string`);
    }
    else if (Array.isArray(envFile)) {
      if (envFile.length === 0) {
        errors.push(`envs[${idx}].envFile: array must contain at least one path`);
      }
      else {
        envFile.forEach((p, j) => {
          if (typeof p !== 'string' || p.length === 0)
            errors.push(`envs[${idx}].envFile[${j}]: must be a non-empty string`);
        });
      }
    }
    else {
      errors.push(`envs[${idx}].envFile: must be a string or array of strings`);
    }

    if (typeof suffix !== 'string')
      errors.push(`envs[${idx}].suffix: must be a string (use "" for no suffix)`);
    else if (suffix.length > 0 && !WORKER_NAME_REGEX.test(suffix))
      errors.push(`envs[${idx}].suffix: must match ${WORKER_NAME_REGEX} when non-empty (got "${suffix}")`);
  });
  return errors;
}
