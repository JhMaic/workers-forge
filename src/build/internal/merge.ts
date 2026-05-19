import type { WorkerBindings } from '../../runtime/bindings';
import type { WorkerMeta } from '../../runtime/define';
import type { DurableObjectMeta } from '../../runtime/durable-object';
import type { BaseConfig } from '../base-config';
import { deriveClassName } from './derive-class-name';
import { triggersToWranglerFields } from './triggers';

export type ModuleKind = 'worker' | 'durable_object';

export interface MergeArgs {
  moduleName: string;
  prefix: string;
  sourcePath: string;
  meta: WorkerMeta | DurableObjectMeta;
  /**
   * Discriminator selected by `validateModule`. Drives DO-only behavior:
   *   - emit `migrations` with the derived class name
   *   - skip trigger merging (DOs have no fetch-level triggers)
   */
  kind?: ModuleKind;
  base: BaseConfig;
  // Names of sibling modules in the same build. A `services[].service` that
  // matches one of these is rewritten to `${prefix}${name}` so the binding
  // resolves to the actually-deployed worker. Other names pass through (they
  // refer to externally-deployed workers).
  siblings?: ReadonlySet<string>;
  /**
   * Appended verbatim to the worker name (`${prefix}${moduleName}${suffix}`)
   * and to sibling service-binding `service` fields. The kit inserts no
   * separator — include any desired separator in the value (e.g. `"-staging"`).
   * Absent when no env is active (names remain unsuffixed).
   */
  suffix?: string;
  /**
   * Strict overlay map applied to declared `vars`: only keys already present
   * in `meta.bindings.vars` are overridden. Extra keys are ignored.
   */
  varsOverrides?: Readonly<Record<string, string>>;
}

const PASSTHROUGH_BINDINGS: readonly (keyof WorkerBindings)[] = [
  'kv_namespaces',
  'd1_databases',
  'r2_buckets',
  'ai',
  'vars',
  'secrets_store_secrets',
  'vectorize',
  'browser',
  'analytics_engine_datasets',
  'hyperdrive',
  'send_email',
];

export function mergeWranglerConfig(args: MergeArgs): Record<string, unknown> {
  const { moduleName, prefix, sourcePath, meta, base, siblings, suffix, varsOverrides } = args;
  const kind: ModuleKind = args.kind ?? 'worker';

  const suffixPart = suffix ?? '';
  const out: Record<string, unknown> = {
    ...structuredClone(base),
    name: `${prefix}${moduleName}${suffixPart}`,
    main: sourcePath,
  };

  const bindings = meta.bindings;
  if (bindings) {
    for (const field of PASSTHROUGH_BINDINGS) {
      if (bindings[field] !== undefined)
        out[field] = bindings[field];
    }
    if (bindings.vars && varsOverrides) {
      const overlay: Record<string, string> = { ...bindings.vars };
      for (const key of Object.keys(bindings.vars)) {
        if (Object.prototype.hasOwnProperty.call(varsOverrides, key))
          overlay[key] = varsOverrides[key]!;
      }
      out.vars = overlay;
    }
    if (bindings.services) {
      out.services = Object.entries(bindings.services).map(([binding, s]) => {
        const { service, environment } = s;
        const resolved = siblings?.has(service) ? `${prefix}${service}${suffixPart}` : service;
        return environment
          ? { binding, service: resolved, environment }
          : { binding, service: resolved };
      });
    }
    if (bindings.durable_objects) {
      out.durable_objects = {
        bindings: Object.entries(bindings.durable_objects).map(([name, d]) => {
          const { scriptName, environment } = d;
          const isSibling = siblings?.has(scriptName) ?? false;
          const resolvedScript = isSibling ? `${prefix}${scriptName}${suffixPart}` : scriptName;
          const entry: Record<string, string> = {
            name,
            class_name: deriveClassName(scriptName),
            script_name: resolvedScript,
          };
          if (environment)
            entry.environment = environment;
          return entry;
        }),
      };
    }
    if (bindings.queues?.producers)
      out.queues = { ...(out.queues as object | undefined), producers: [...bindings.queues.producers] };
  }

  if (kind === 'worker') {
    const triggerFields = triggersToWranglerFields((meta as WorkerMeta).triggers);
    if (triggerFields.triggers)
      out.triggers = triggerFields.triggers;
    if (triggerFields.queues?.consumers)
      out.queues = { ...(out.queues as object | undefined), consumers: triggerFields.queues.consumers };
    if (triggerFields.tail_consumers)
      out.tail_consumers = triggerFields.tail_consumers;
  }

  if (kind === 'durable_object') {
    const doMeta = meta as DurableObjectMeta;
    const className = deriveClassName(doMeta.name);
    const migrationKey = doMeta.storage === 'kv' ? 'new_classes' : 'new_sqlite_classes';
    out.migrations = [{ tag: 'v1', [migrationKey]: [className] }];
  }

  if (meta._raw)
    Object.assign(out, structuredClone(meta._raw as Record<string, unknown>));

  return out;
}
