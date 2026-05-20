import type {
  Ai,
  AnalyticsEngineDataset,
  D1Database,
  DurableObjectNamespace,
  Fetcher,
  Hyperdrive,
  KVNamespace,
  Queue,
  R2Bucket,
  Rpc,
  SecretsStoreSecret,
  VectorizeIndex,
} from '@cloudflare/workers-types';

type BrowserBinding = Fetcher;
type EmptyBindings = Record<never, never>;

/**
 * Recursive JSON-safe value for use in RPC return types and payload fields.
 *
 * `@cloudflare/workers-types` exposes `Rpc.Result<T>` and `Rpc.Serializable<T>`
 * to prove at compile time that a value can survive structured-clone across the
 * worker RPC boundary. The proof is conservative: any property typed as
 * `unknown` (commonly `Record<string, unknown>`) fails every branch of
 * `Serializable<T>` and collapses `Rpc.Result<T>` to `never`, because the type
 * system cannot prove `unknown` won't carry functions, Symbols, unresolved
 * Promises, or other values the runtime would reject with `DataCloneError`.
 *
 * Use `RpcJson` (or `Record<string, RpcJson>`) for fields you know are
 * JSON-safe — e.g. D1 columns declared with `mode: 'json'`. This narrows the
 * type enough for `Serializable<T>` to accept it, restoring end-to-end RPC
 * typing without disabling the runtime structured-clone check.
 *
 * @example
 * import type { RpcJson } from 'workers-forge';
 *
 * // Drizzle schema — declare a JSON-mode column as JSON, not `unknown`:
 * payload: text('payload', { mode: 'json' }).$type<Record<string, RpcJson>>().notNull(),
 */
export type RpcJson =
  | string
  | number
  | boolean
  | null
  | RpcJson[]
  | { readonly [key: string]: RpcJson };

/**
 * Service binding stub — a Fetcher augmented with pipelining-aware RPC methods.
 * - Methods returning RpcTarget (Stubable): uses Rpc.Result for promise pipelining
 * - All other methods: standard async RPC returning Promise<T>.
 * Reserved methods `fetch` and `connect` are omitted (provided by Fetcher).
 */
export type ServiceStub<RPC extends object> = Fetcher & {
  [K in Exclude<keyof RPC, 'fetch' | 'connect'>]: RPC[K] extends (...args: infer A) => infer R
    ? (...args: A) => Awaited<R> extends Rpc.Stubable
        ? Rpc.Result<Awaited<R>>
        : R extends Promise<unknown> ? R : Promise<Awaited<R>>
    : RPC[K];
};

/**
 * Declaration shape for a service binding, used as a value in `WorkerBindings.services`.
 * The Record key in `services` becomes the `binding` name in wrangler.jsonc.
 */
export interface ServiceBindingDecl<RPC = unknown> {
  /**
   * The name of the target Cloudflare Worker. May be rewritten for sibling workers during build.
   *
   * @example
   * // TypeScript
   * services: { MY_WORKER: { service: 'my-worker' } }
   *
   * // wrangler.jsonc output
   * "services": [{ "binding": "MY_WORKER", "service": "my-worker" }]
   */
  service: string;
  /**
   * Optional named environment of the target worker to bind to (e.g. `"production"`, `"staging"`).
   *
   * @example
   * // TypeScript
   * services: { MY_WORKER: service<MyWorkerRPC>('my-worker', 'production') }
   *
   * // wrangler.jsonc output
   * "services": [{ "binding": "MY_WORKER", "service": "my-worker", "environment": "production" }]
   */
  environment?: string;
  /**
   * Phantom field — type-only marker carrying the target worker's RPC interface.
   * Stripped at build time before emitting wrangler.jsonc.
   */
  __rpc?: RPC;
}

/**
 * Creates a service binding declaration for use as a value in `WorkerBindings.services`.
 * The Record key becomes the `binding` name; this value carries the target worker name
 * and optional environment, plus a phantom `__rpc` type for IntelliSense.
 *
 * @param name - The name of the target worker (the `service` field in wrangler.jsonc).
 * @param environment - Optional named environment of the target worker to bind to.
 * @returns A `ServiceBindingDecl<RPC>` ready to place in `bindings.services`.
 *
 * @example
 * // TypeScript
 * services: { MY_WORKER: service<MyWorkerRPC>('my-worker') }
 *
 * // wrangler.jsonc output
 * "services": [{ "binding": "MY_WORKER", "service": "my-worker" }]
 *
 * @example
 * // With environment
 * // TypeScript
 * services: { MY_WORKER: service<MyWorkerRPC>('my-worker', 'production') }
 *
 * // wrangler.jsonc output
 * "services": [{ "binding": "MY_WORKER", "service": "my-worker", "environment": "production" }]
 */
export function service<RPC = unknown>(
  name: string,
  environment?: string,
): ServiceBindingDecl<RPC> {
  return environment ? { service: name, environment } : { service: name };
}

/**
 * Declaration shape for a Durable Object binding, used as a value in
 * `WorkerBindings.durable_objects`. The Record key becomes the wrangler
 * `name` field; the value carries the target DO module's worker name and
 * (via a phantom `__rpc`) the RPC type for `this.env.<binding>` inference.
 *
 * The runtime `class_name` is derived from `scriptName` at build time and
 * is never written by the user.
 */
export interface DurableObjectBindingDecl<RPC = unknown> {
  /**
   * Worker `name` of the DO module hosting the class. May be rewritten with
   * the project prefix/suffix during build when it matches a sibling module.
   *
   * @example
   * // TypeScript
   * durable_objects: { COUNTER: { scriptName: 'counter' } }
   *
   * // wrangler.jsonc output (with prefix "pfx-" and suffix "-stage")
   * "durable_objects": { "bindings": [{ "name": "COUNTER", "class_name": "Counter", "script_name": "pfx-counter-stage" }] }
   */
  scriptName: string;
  /**
   * Optional named environment of the target DO module to bind to.
   */
  environment?: string;
  /**
   * Phantom field — type-only marker carrying the DO's RPC interface for
   * IntelliSense on `this.env.<binding>.get(id).<method>(...)`. Stripped at
   * build time before emitting wrangler.jsonc.
   */
  __rpc?: RPC;
}

/**
 * Creates a Durable Object binding declaration for use as a value in
 * `WorkerBindings.durable_objects`. Mirrors `service<RPC>('name')` exactly:
 * the Record key becomes the wrangler binding `name`, the string argument is
 * the target DO module's worker name, and the generic carries the RPC type.
 *
 * @param scriptName - The DO module's worker `name` (sibling-rewritten at build time).
 * @param environment - Optional named environment of the target DO module.
 *
 * @example
 * ```ts
 * import type { CounterRPC } from '../counter';
 * durable_objects: { COUNTER: durableObject<CounterRPC>('counter') }
 * ```
 */
export function durableObject<RPC = unknown>(
  scriptName: string,
  environment?: string,
): DurableObjectBindingDecl<RPC> {
  return environment ? { scriptName, environment } : { scriptName };
}

/**
 * Declaration for an Email Routing `send_email` binding.
 * Maps to an entry in the `send_email` array in wrangler.jsonc.
 */
export interface SendEmailDecl {
  /**
   * The binding name used in wrangler.jsonc and exposed as `env.<name>` at runtime.
   *
   * @example
   * // TypeScript
   * send_email: [{ name: 'MAILER' }]
   *
   * // wrangler.jsonc output
   * "send_email": [{ "name": "MAILER" }]
   */
  name: string;
  /**
   * Restricts sending to this single address only.
   * Mutually exclusive with `allowed_destination_addresses`.
   *
   * @example
   * // TypeScript
   * send_email: [{ name: 'MAILER', destination_address: 'admin@example.com' }]
   *
   * // wrangler.jsonc output
   * "send_email": [{ "name": "MAILER", "destination_address": "admin@example.com" }]
   */
  destination_address?: string;
  /**
   * Restricts sending to addresses in this list only.
   * Mutually exclusive with `destination_address`.
   *
   * @example
   * // TypeScript
   * send_email: [{ name: 'MAILER', allowed_destination_addresses: ['a@example.com', 'b@example.com'] }]
   *
   * // wrangler.jsonc output
   * "send_email": [{ "name": "MAILER", "allowed_destination_addresses": ["a@example.com", "b@example.com"] }]
   */
  allowed_destination_addresses?: string[];
}

/**
 * Declares all Cloudflare bindings for a worker.
 * Each field maps to a top-level section in the emitted `wrangler.jsonc`.
 * Exception: `services` is transformed from a Record to an array during build.
 */
export interface WorkerBindings {
  /**
   * KV Namespace bindings, accessible as `this.env.<binding>` (`KVNamespace`).
   *
   * @example
   * // TypeScript
   * kv_namespaces: [{ binding: 'CACHE', id: 'abc123' }]
   *
   * // wrangler.jsonc output
   * "kv_namespaces": [{ "binding": "CACHE", "id": "abc123" }]
   */
  kv_namespaces?: readonly { binding: string; id: string; preview_id?: string }[];

  /**
   * D1 Database bindings, accessible as `this.env.<binding>` (`D1Database`).
   *
   * @example
   * // TypeScript
   * d1_databases: [{ binding: 'DB', database_id: 'abc123' }]
   *
   * // wrangler.jsonc output
   * "d1_databases": [{ "binding": "DB", "database_id": "abc123" }]
   */
  d1_databases?: readonly { binding: string; database_id: string; database_name?: string }[];

  /**
   * R2 Bucket bindings, accessible as `this.env.<binding>` (`R2Bucket`).
   *
   * @example
   * // TypeScript
   * r2_buckets: [{ binding: 'ASSETS', bucket_name: 'my-bucket' }]
   *
   * // wrangler.jsonc output
   * "r2_buckets": [{ "binding": "ASSETS", "bucket_name": "my-bucket" }]
   */
  r2_buckets?: readonly { binding: string; bucket_name: string }[];

  /**
   * Service bindings — RPC connections to other Cloudflare Workers.
   * Each Record key becomes the `binding` name accessible as `this.env.<key>`.
   * Use the `service()` helper to declare each entry.
   * Note: sibling worker names may be rewritten with a project prefix/suffix during build.
   *
   * @example
   * // TypeScript
   * services: { MY_WORKER: service<MyWorkerRPC>('my-worker') }
   *
   * // wrangler.jsonc output
   * "services": [{ "binding": "MY_WORKER", "service": "my-worker" }]
   */
  services?: Readonly<Record<string, ServiceBindingDecl>>;

  /**
   * Queue **producer** bindings, accessible as `this.env.<binding>` (`Queue`).
   * For queue consumer triggers, use `WorkerTriggers.queue` instead.
   *
   * @example
   * // TypeScript
   * queues: { producers: [{ binding: 'MY_QUEUE', queue: 'my-queue' }] }
   *
   * // wrangler.jsonc output
   * "queues": { "producers": [{ "binding": "MY_QUEUE", "queue": "my-queue" }] }
   */
  queues?: { producers?: readonly { binding: string; queue: string }[] };

  /**
   * Workers AI binding, accessible as `this.env.<binding>` (`Ai`).
   *
   * @example
   * // TypeScript
   * ai: { binding: 'AI' }
   *
   * // wrangler.jsonc output
   * "ai": { "binding": "AI" }
   */
  ai?: { binding: string };

  /**
   * Plain-text environment variables, accessible as `this.env.<key>` (`string`).
   * Values are copied verbatim to `wrangler.jsonc` and can be overridden
   * per environment via the kit's `envs` configuration.
   *
   * @example
   * // TypeScript
   * vars: { API_URL: 'https://api.example.com' }
   *
   * // wrangler.jsonc output
   * "vars": { "API_URL": "https://api.example.com" }
   */
  vars?: Record<string, string>;

  /**
   * Secrets Store bindings, accessible as `this.env.<binding>` (`SecretsStoreSecret`).
   *
   * @example
   * // TypeScript
   * secrets_store_secrets: [{ binding: 'MY_SECRET', store_id: 'store123', secret_name: 'api-key' }]
   *
   * // wrangler.jsonc output
   * "secrets_store_secrets": [{ "binding": "MY_SECRET", "store_id": "store123", "secret_name": "api-key" }]
   */
  secrets_store_secrets?: readonly { binding: string; store_id: string; secret_name: string }[];

  /**
   * Vectorize Index bindings, accessible as `this.env.<binding>` (`VectorizeIndex`).
   *
   * @example
   * // TypeScript
   * vectorize: [{ binding: 'VECTORS', index_name: 'my-index' }]
   *
   * // wrangler.jsonc output
   * "vectorize": [{ "binding": "VECTORS", "index_name": "my-index" }]
   */
  vectorize?: readonly { binding: string; index_name: string }[];

  /**
   * Browser Rendering binding, accessible as `this.env.<binding>` (`Fetcher`).
   *
   * @example
   * // TypeScript
   * browser: { binding: 'BROWSER' }
   *
   * // wrangler.jsonc output
   * "browser": { "binding": "BROWSER" }
   */
  browser?: { binding: string };

  /**
   * Analytics Engine Dataset bindings, accessible as `this.env.<binding>` (`AnalyticsEngineDataset`).
   *
   * @example
   * // TypeScript
   * analytics_engine_datasets: [{ binding: 'ANALYTICS', dataset: 'my-dataset' }]
   *
   * // wrangler.jsonc output
   * "analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "my-dataset" }]
   */
  analytics_engine_datasets?: readonly { binding: string; dataset?: string }[];

  /**
   * Hyperdrive bindings, accessible as `this.env.<binding>` (`Hyperdrive`).
   *
   * @example
   * // TypeScript
   * hyperdrive: [{ binding: 'DB_PROXY', id: 'abc123' }]
   *
   * // wrangler.jsonc output
   * "hyperdrive": [{ "binding": "DB_PROXY", "id": "abc123" }]
   */
  hyperdrive?: readonly { binding: string; id: string }[];

  /**
   * Email Routing send_email bindings. Each entry exposes a `send()` method
   * accessible as `this.env.<name>`.
   *
   * @example
   * // TypeScript
   * send_email: [{ name: 'MAILER' }]
   *
   * // wrangler.jsonc output
   * "send_email": [{ "name": "MAILER" }]
   */
  send_email?: readonly SendEmailDecl[];

  /**
   * Durable Object bindings — namespaces for invoking DOs from this worker.
   * Each Record key becomes the wrangler `name` accessible as `this.env.<key>`.
   * Use the `durableObject()` helper to declare each entry.
   *
   * Note: same-project DO module `scriptName`s are rewritten with the project
   * prefix/suffix during build. The runtime `class_name` is derived from the
   * scriptName (kebab/snake → PascalCase) — never written by the user.
   *
   * @example
   * // TypeScript
   * import type { CounterRPC } from '../counter';
   * durable_objects: { COUNTER: durableObject<CounterRPC>('counter') }
   *
   * // wrangler.jsonc output (with prefix "pfx-")
   * "durable_objects": { "bindings": [{ "name": "COUNTER", "class_name": "Counter", "script_name": "pfx-counter" }] }
   */
  durable_objects?: Readonly<Record<string, DurableObjectBindingDecl>>;
}

// --- InferEnv helpers ------------------------------------------------------

type ArrayBindingMap<T extends readonly { binding: string }[] | undefined, V>
  = T extends readonly (infer Item)[]
    ? Item extends { binding: infer B extends string }
      ? { [K in B]: V }
      : EmptyBindings
    : EmptyBindings;

type ServiceRecordMap<T extends Readonly<Record<string, ServiceBindingDecl>> | undefined>
  = T extends Readonly<Record<string, ServiceBindingDecl>>
    ? {
        [K in keyof T]: T[K] extends { __rpc?: infer R }
          ? unknown extends R
            ? Fetcher
            : R extends object
              ? ServiceStub<R>
              : Fetcher
          : Fetcher;
      }
    : EmptyBindings;

type DurableObjectRecordMap<T extends Readonly<Record<string, DurableObjectBindingDecl>> | undefined>
  = T extends Readonly<Record<string, DurableObjectBindingDecl>>
    ? {
        [K in keyof T]: T[K] extends { __rpc?: infer R }
          ? unknown extends R
            ? DurableObjectNamespace
            : R extends object
              ? DurableObjectNamespace<R & Rpc.DurableObjectBranded>
              : DurableObjectNamespace
          : DurableObjectNamespace;
      }
    : EmptyBindings;

type SingleBindingMap<T extends { binding: string } | undefined, V>
  = T extends { binding: infer B extends string } ? { [K in B]: V } : EmptyBindings;

type VarsMap<T extends Record<string, string> | undefined>
  = T extends Record<string, string> ? { [K in keyof T]: string } : EmptyBindings;

type SendEmailMap<T extends readonly SendEmailDecl[] | undefined>
  = T extends readonly (infer Item)[]
    ? Item extends { name: infer N extends string }
      ? { [K in N]: { send: (message: unknown) => Promise<void> } }
      : EmptyBindings
    : EmptyBindings;

type UnionToIntersection<U>
  = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type FlattenMerge<T> = { [K in keyof T]: T[K] };

export type InferEnv<C extends { bindings?: WorkerBindings | undefined }>
  = C['bindings'] extends infer B
    ? B extends WorkerBindings
      ? FlattenMerge<UnionToIntersection<
        | ArrayBindingMap<B['kv_namespaces'], KVNamespace>
        | ArrayBindingMap<B['d1_databases'], D1Database>
        | ArrayBindingMap<B['r2_buckets'], R2Bucket>
        | ServiceRecordMap<B['services']>
        | ArrayBindingMap<
          B['queues'] extends { producers?: infer P }
            ? P extends readonly { binding: string }[] ? P : undefined
            : undefined,
          Queue
        >
        | SingleBindingMap<B['ai'], Ai>
        | VarsMap<B['vars']>
        | ArrayBindingMap<B['secrets_store_secrets'], SecretsStoreSecret>
        | ArrayBindingMap<B['vectorize'], VectorizeIndex>
        | SingleBindingMap<B['browser'], BrowserBinding>
        | ArrayBindingMap<B['analytics_engine_datasets'], AnalyticsEngineDataset>
        | ArrayBindingMap<B['hyperdrive'], Hyperdrive>
        | SendEmailMap<B['send_email']>
        | DurableObjectRecordMap<B['durable_objects']>
      >>
      : EmptyBindings
    : EmptyBindings;
