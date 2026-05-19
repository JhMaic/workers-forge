import type { DurableObjectState, Rpc } from '@cloudflare/workers-types';
import type { Unstable_RawEnvironment } from 'wrangler';
import type { InferEnv, WorkerBindings } from './bindings';
import { DurableObject } from './entrypoint';

const DO_META_BRAND = Symbol.for('workers-forge/do-meta');

/**
 * Declarative metadata for a Durable Object module.
 *
 * One DO module = one Worker script (the DO is its own host). The `name` is the
 * worker script name; the runtime `class_name` is derived from `name` at build
 * time (kebab/snake-case → PascalCase), so it never appears in user code.
 *
 * Consumers from other workers reference this DO via the string `name` and a
 * type-only RPC import, mirroring `service<RPC>('name')`.
 */
export interface DurableObjectMeta<TBindings extends WorkerBindings = WorkerBindings> {
  /**
   * Worker script name. Participates in sibling rewriting with the same
   * `${prefix}${name}${suffix}` rules as `defineWorker`.
   *
   * The runtime class name is derived from this via kebab/snake → PascalCase
   * (e.g. `'counter'` → `Counter`, `'user-session'` → `UserSession`).
   */
  name: string;

  /**
   * Storage backend for the DO class.
   * - `'sqlite'` (default): emits `migrations[].new_sqlite_classes` — the
   *   Cloudflare-recommended default for new DO classes.
   * - `'kv'`: emits `migrations[].new_classes` (legacy KV-backed storage).
   *
   * If you need rename/delete migrations, write `_raw.migrations` to override
   * the auto-generated initial migration entirely.
   */
  storage?: 'sqlite' | 'kv';

  /**
   * Cloudflare bindings exposed on `this.env` inside DO methods.
   * Same shape as `WorkerBindings` — full `InferEnv` typing.
   */
  bindings?: TBindings;

  /**
   * Raw wrangler config fields applied at the highest priority. Use this to
   * write explicit `migrations` arrays (e.g. with `renamed_classes` /
   * `deleted_classes`) when you need more than the auto-generated initial entry.
   */
  _raw?: Omit<Unstable_RawEnvironment, 'name' | 'main'>;
}

/**
 * Built-in DurableObject handler methods — excluded from the custom RPC surface
 * that `DurableObjectRPC<D>` exposes.
 */
export type BuiltinDurableObjectKeys
  = | 'alarm' | 'fetch' | 'connect'
    | 'webSocketMessage' | 'webSocketClose' | 'webSocketError';

export interface DefinedDurableObject<
  TBindings extends WorkerBindings = WorkerBindings,
  TMethods extends Record<string, ((...args: any[]) => any) | object> = Record<string, ((...args: any[]) => any) | object>,
> {
  new (ctx: DurableObjectState, env: InferEnv<{ bindings: TBindings }>):
  DurableObject<InferEnv<{ bindings: TBindings }>> & TMethods;
  readonly __meta: DurableObjectMeta<TBindings>;
  /** Phantom field — carries TMethods for DurableObjectRPC inference without going through the intersection. */
  readonly __rpc: TMethods;
}

/**
 * Declare a Durable Object class.
 *
 * The single module file becomes a complete Worker script that hosts the DO
 * class. The build emits the wrangler.jsonc (with auto-generated `migrations`)
 * and an entry barrel that re-exports the class under its derived PascalCase
 * name so workerd can resolve it.
 *
 * @example
 * ```ts
 * const counter = defineDurableObject(
 *   { name: 'counter' },
 *   {
 *     async increment(by = 1) {
 *       const v = (await this.ctx.storage.get<number>('n')) ?? 0;
 *       await this.ctx.storage.put('n', v + by);
 *       return v + by;
 *     },
 *   },
 * );
 *
 * export type CounterRPC = DurableObjectRPC<typeof counter>;
 * export default counter;
 * ```
 */
export function defineDurableObject<
  const TBindings extends WorkerBindings,
  const TMethods extends Record<string, ((...args: any[]) => any) | object>,
>(
  meta: DurableObjectMeta<TBindings>,
  methods: TMethods & ThisType<
    DurableObject<InferEnv<{ bindings: TBindings }>>
    & { env: InferEnv<{ bindings: TBindings }>; ctx: DurableObjectState }
    & TMethods
  >,
): DefinedDurableObject<TBindings, TMethods> {
  class GeneratedDurableObject extends (DurableObject as any) {
    static [DO_META_BRAND] = true as const;
    static __meta = meta;
  }

  for (const key of Object.getOwnPropertyNames(methods)) {
    const desc = Object.getOwnPropertyDescriptor(methods, key)!;
    if (desc.get != null) {
      Object.defineProperty(GeneratedDurableObject.prototype, key, desc);
    }
    else if (typeof desc.value === 'function') {
      (GeneratedDurableObject.prototype as any)[key] = desc.value;
    }
  }

  return GeneratedDurableObject as unknown as DefinedDurableObject<TBindings, TMethods>;
}

/**
 * Identity helper that types a `DurableObjectMeta` object literal while
 * preserving its narrow `const` shape — analogous to `defineWorkerMeta`.
 */
export function defineDurableObjectMeta<const T extends DurableObjectMeta>(meta: T): T {
  return meta;
}

export function isDefinedDurableObject(value: unknown): value is DefinedDurableObject {
  return typeof value === 'function'
    && (value as any)[DO_META_BRAND] === true;
}

export function getDurableObjectMeta<D extends DefinedDurableObject>(
  doClass: D,
): D extends DefinedDurableObject<infer B> ? DurableObjectMeta<B> : never {
  return (doClass as any).__meta;
}

/**
 * Extract the public RPC surface of a `DefinedDurableObject`. Mirrors
 * `WorkerRPC<typeof worker>`: strips built-in handlers, leaving only the
 * user-defined methods. Use this with `durableObject<RPC>('name')` on the
 * consumer side, via a type-only import:
 *
 * ```ts
 * // counter/index.ts
 * export type CounterRPC = DurableObjectRPC<typeof counter>;
 *
 * // gateway/index.ts
 * import type { CounterRPC } from '../counter';
 * durable_objects: { COUNTER: durableObject<CounterRPC>('counter') }
 * ```
 */
export type DurableObjectRPC<D>
  = D extends { readonly __rpc: infer TMethods }
    ? Omit<TMethods, BuiltinDurableObjectKeys>
    : never;

// Branded version used by InferEnv to satisfy DurableObjectNamespace<T>'s
// `T extends Rpc.DurableObjectBranded` constraint without forcing users to
// brand their RPC interfaces themselves.
export type BrandedDurableObjectRPC<RPC>
  = RPC extends object
    ? RPC & Rpc.DurableObjectBranded
    : Rpc.DurableObjectBranded;
