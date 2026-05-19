import type { DurableObjectMeta } from '../../runtime/durable-object';
import type { DefinedWorker, WorkerMeta } from '../../runtime/define';
import type { DefinedDurableObject } from '../../runtime/durable-object';
import type { EnvConfig } from '../build';
import { moduleNameMaxLen, WORKER_NAME_REGEX } from '../../runtime/constants';
import { getWorkerMeta, isDefinedWorker } from '../../runtime/define';
import { getDurableObjectMeta, isDefinedDurableObject } from '../../runtime/durable-object';
import { deriveClassName, isValidClassName } from './derive-class-name';

export type ValidationResult
  = | { ok: true; kind: 'worker'; meta: WorkerMeta }
    | { ok: true; kind: 'durable_object'; meta: DurableObjectMeta }
    | { ok: false; errors: string[] };

export function validateModule(
  file: string,
  defaultExport: unknown,
  prefix: string,
): ValidationResult {
  if (isDefinedWorker(defaultExport)) {
    return validateWorker(file, defaultExport, prefix);
  }
  if (isDefinedDurableObject(defaultExport)) {
    return validateDurableObject(file, defaultExport, prefix);
  }
  return {
    ok: false,
    errors: [`${file}: default export is not a defineWorker() or defineDurableObject() product`],
  };
}

function validateWorker(file: string, worker: DefinedWorker, prefix: string): ValidationResult {
  const errors: string[] = [];
  const meta = getWorkerMeta(worker);
  errors.push(...validateName(file, meta.name, prefix));

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
  return { ok: true, kind: 'worker', meta };
}

function validateDurableObject(
  file: string,
  doClass: DefinedDurableObject,
  prefix: string,
): ValidationResult {
  const errors: string[] = [];
  const meta = getDurableObjectMeta(doClass);
  errors.push(...validateName(file, meta.name, prefix));

  if (typeof meta.name === 'string' && meta.name.length > 0) {
    const className = deriveClassName(meta.name);
    if (!className || !isValidClassName(className)) {
      errors.push(
        `${file}: derived class name "${className}" from name "${meta.name}" is not a valid JS identifier. `
        + `Choose a name that yields a valid PascalCase identifier (e.g. avoid leading digits).`,
      );
    }
  }

  if (meta.storage !== undefined && meta.storage !== 'sqlite' && meta.storage !== 'kv') {
    errors.push(`${file}: storage must be 'sqlite' or 'kv' (got ${JSON.stringify(meta.storage)})`);
  }

  if (errors.length > 0)
    return { ok: false, errors };
  return { ok: true, kind: 'durable_object', meta };
}

function validateName(file: string, name: unknown, prefix: string): string[] {
  const errors: string[] = [];
  const maxLen = moduleNameMaxLen(prefix);
  if (typeof name !== 'string' || name.length === 0) {
    errors.push(`${file}: meta.name must be a non-empty string`);
  }
  else if (!WORKER_NAME_REGEX.test(name)) {
    errors.push(`${file}: meta.name must match ${WORKER_NAME_REGEX} (got "${name}")`);
  }
  else if (name.length > maxLen) {
    errors.push(
      `${file}: meta.name length ${name.length} exceeds limit ${maxLen} `
      + `(deployed name "${prefix}${name}" must be ≤ 63 chars)`,
    );
  }
  return errors;
}

export type RegistryEntry
  = | { kind: 'worker'; file: string; value: DefinedWorker; meta: WorkerMeta }
    | { kind: 'durable_object'; file: string; value: DefinedDurableObject; meta: DurableObjectMeta };

export function validateRegistry(entries: readonly RegistryEntry[]): string[] {
  const errors: string[] = [];
  const byName = new Map<string, string>();

  for (const e of entries) {
    const prev = byName.get(e.meta.name);
    if (prev)
      errors.push(`Duplicate module name "${e.meta.name}": ${prev} and ${e.file}`);
    else
      byName.set(e.meta.name, e.file);
  }

  const known = new Set(byName.keys());
  for (const e of entries) {
    const bindings = e.meta.bindings;
    if (!bindings)
      continue;
    for (const [binding, svc] of Object.entries(bindings.services ?? {})) {
      if (!known.has(svc.service)) {
        errors.push(
          `${e.file}: service binding "${binding}" references unknown worker `
          + `"${svc.service}" (not declared by any module in this build)`,
        );
      }
    }
    for (const [binding, decl] of Object.entries(bindings.durable_objects ?? {})) {
      const target = entries.find(x => x.meta.name === decl.scriptName);
      if (!target) {
        errors.push(
          `${e.file}: durable_objects binding "${binding}" references unknown DO module `
          + `"${decl.scriptName}" (not declared by any module in this build)`,
        );
      }
      else if (target.kind !== 'durable_object') {
        errors.push(
          `${e.file}: durable_objects binding "${binding}" references "${decl.scriptName}" `
          + `which is a worker, not a DO module. Use defineDurableObject() for the target.`,
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
