import type { DurableObjectNamespace, Rpc } from '@cloudflare/workers-types';
import type { InferEnv, WorkerBindings } from '../runtime/bindings';
import type { DefinedDurableObject, DurableObjectRPC } from '../runtime/durable-object';

/**
 * Infer the runtime env shape for a worker defined with `defineWorker`.
 * Use it to augment `Cloudflare.Env` so `env.<binding>` is fully typed in
 * `cloudflare:test`-style tests.
 *
 * @example
 * import gateway from '../index';
 * import type { WorkerEnv } from 'workers-forge/testing';
 *
 * declare global {
 *   namespace Cloudflare {
 *     interface Env extends WorkerEnv<typeof gateway> {}
 *   }
 * }
 */
export type WorkerEnv<W>
  = W extends { readonly __meta: { bindings?: infer B } }
    ? B extends WorkerBindings
      ? InferEnv<{ bindings: B }>
      : Record<string, unknown>
    : never;

/**
 * Build the env shape for a Durable Object module under test, exposing a
 * self-binding so the test can grab a stub via `env.<K>.get(...)`.
 *
 * Mirrors `durableObject<RPC>('name')` on the consumer side: the binding name
 * `K` becomes a `DurableObjectNamespace` typed with the DO's RPC surface
 * (built-in handlers stripped, RPC class branded).
 *
 * The kit's vitest helper auto-injects a matching self-binding via miniflare,
 * so the test only needs to declare its type here.
 *
 * @example
 * import counter from '../index';
 * import type { DurableObjectTestEnv } from 'workers-forge/testing';
 *
 * declare global {
 *   namespace Cloudflare {
 *     interface Env extends DurableObjectTestEnv<typeof counter, 'COUNTER'> {}
 *   }
 * }
 */
export type DurableObjectTestEnv<D, K extends string>
  = D extends DefinedDurableObject<infer _B, any>
    ? DurableObjectRPC<D> extends infer R
      ? R extends object
        ? { [P in K]: DurableObjectNamespace<R & Rpc.DurableObjectBranded> }
        : { [P in K]: DurableObjectNamespace }
      : never
    : never;
