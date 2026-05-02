import type { InferEnv, WorkerBindings } from './bindings';
import { WorkerEntrypoint } from './entrypoint';

const META_BRAND = Symbol.for('workers-forge/meta');

/**
 * Configuration for a queue consumer trigger.
 * Used inside `WorkerTriggers.queue.consumers`.
 * Maps to an entry in `queues.consumers` in wrangler.jsonc.
 */
export interface QueueConsumerDecl {
  /**
   * The name of the Queue to consume.
   *
   * @example
   * // TypeScript
   * queue: { consumers: [{ queue: 'my-queue' }] }
   *
   * // wrangler.jsonc output
   * "queues": { "consumers": [{ "queue": "my-queue" }] }
   */
  queue: string;
  /**
   * Maximum number of messages to deliver in a single batch (1–10000).
   *
   * @example
   * // TypeScript
   * queue: { consumers: [{ queue: 'my-queue', max_batch_size: 10 }] }
   *
   * // wrangler.jsonc output
   * "queues": { "consumers": [{ "queue": "my-queue", "max_batch_size": 10 }] }
   */
  max_batch_size?: number;
  /**
   * Maximum time in seconds to wait for a batch to fill before delivering (0–30).
   *
   * @example
   * // TypeScript
   * queue: { consumers: [{ queue: 'my-queue', max_batch_timeout: 5 }] }
   *
   * // wrangler.jsonc output
   * "queues": { "consumers": [{ "queue": "my-queue", "max_batch_timeout": 5 }] }
   */
  max_batch_timeout?: number;
  /**
   * Maximum number of retries before sending a message to the dead letter queue (0–100).
   *
   * @example
   * // TypeScript
   * queue: { consumers: [{ queue: 'my-queue', max_retries: 3 }] }
   *
   * // wrangler.jsonc output
   * "queues": { "consumers": [{ "queue": "my-queue", "max_retries": 3 }] }
   */
  max_retries?: number;
  /**
   * Name of a Queue to send messages that repeatedly fail processing.
   *
   * @example
   * // TypeScript
   * queue: { consumers: [{ queue: 'my-queue', dead_letter_queue: 'my-queue-dlq' }] }
   *
   * // wrangler.jsonc output
   * "queues": { "consumers": [{ "queue": "my-queue", "dead_letter_queue": "my-queue-dlq" }] }
   */
  dead_letter_queue?: string;
  /**
   * Delay in seconds before a failed message is retried (0–31536000).
   *
   * @example
   * // TypeScript
   * queue: { consumers: [{ queue: 'my-queue', retry_delay: 60 }] }
   *
   * // wrangler.jsonc output
   * "queues": { "consumers": [{ "queue": "my-queue", "retry_delay": 60 }] }
   */
  retry_delay?: number;
}

/**
 * Subscribes this worker to receive tail events from another worker.
 * Maps to an entry in `tail_consumers` in wrangler.jsonc.
 */
export interface TailProducerDecl {
  /**
   * Name of the worker whose tail events this worker will consume. May be rewritten for sibling workers during build.
   *
   * @example
   * // TypeScript
   * tail: { producers: [{ service: 'my-api-worker' }] }
   *
   * // wrangler.jsonc output
   * "tail_consumers": [{ "service": "my-api-worker" }]
   */
  service: string;
  /**
   * Optional named environment of the target worker to consume tail events from.
   *
   * @example
   * // TypeScript
   * tail: { producers: [{ service: 'my-api-worker', environment: 'production' }] }
   *
   * // wrangler.jsonc output
   * "tail_consumers": [{ "service": "my-api-worker", "environment": "production" }]
   */
  environment?: string;
}

/**
 * Declares event triggers that invoke the worker.
 * Maps to `triggers.crons`, `queues.consumers`, and `tail_consumers` in wrangler.jsonc.
 */
export interface WorkerTriggers {
  /**
   * Cron trigger schedule(s) for the worker.
   * Accepts a single cron expression or an array; always emits as an array.
   *
   * @example
   * // TypeScript
   * cron: '0 * * * *'
   * // or
   * cron: ['0 * * * *', '30 * * * *']
   *
   * // wrangler.jsonc output
   * "triggers": { "crons": ["0 * * * *"] }
   */
  cron?: string | readonly string[];

  /**
   * Queue **consumer** configuration — triggered when messages arrive in the queue.
   * For queue producer bindings, use `WorkerBindings.queues` instead.
   *
   * @example
   * // TypeScript
   * queue: { consumers: [{ queue: 'my-queue', max_batch_size: 10 }] }
   *
   * // wrangler.jsonc output
   * "queues": { "consumers": [{ "queue": "my-queue", "max_batch_size": 10 }] }
   */
  queue?: { consumers: readonly QueueConsumerDecl[] };

  /**
   * Tail consumer configuration — subscribes this worker to tail events from other workers.
   *
   * @example
   * // TypeScript
   * tail: { producers: [{ service: 'my-api-worker' }] }
   *
   * // wrangler.jsonc output
   * "tail_consumers": [{ "service": "my-api-worker" }]
   */
  tail?: { producers: readonly TailProducerDecl[] };
}

export interface WorkerMeta<TBindings extends WorkerBindings = WorkerBindings> {
  name: string;
  bindings?: TBindings;
  triggers?: WorkerTriggers;
}

// Methods that exist on WorkerEntrypoint base — excluded from custom RPC surface.
export type BuiltinHandlerKeys
  = | 'fetch' | 'scheduled' | 'email' | 'queue' | 'tail' | 'trace' | 'test'
    | 'env' | 'ctx';

export type WorkerMethods<TEnv> = ThisType<WorkerEntrypoint<TEnv> & { env: TEnv }>
  & Record<string, ((...args: any[]) => any) | object>;

export interface DefinedWorker<
  TBindings extends WorkerBindings = WorkerBindings,
  TMethods extends Record<string, ((...args: any[]) => any) | object> = Record<string, ((...args: any[]) => any) | object>,
> {
  new (ctx: any, env: any):
  WorkerEntrypoint<InferEnv<{ bindings: TBindings }>> & TMethods;
  readonly __meta: WorkerMeta<TBindings>;
  /** Phantom field — carries TMethods for WorkerRPC inference without going through the intersection. */
  readonly __rpc: TMethods;
}

export function defineWorker<
  const TBindings extends WorkerBindings,
  const TMethods extends Record<string, ((...args: any[]) => any) | object>,
>(
  meta: WorkerMeta<TBindings>,
  methods: TMethods & ThisType<
    WorkerEntrypoint<InferEnv<{ bindings: TBindings }>>
    & { env: InferEnv<{ bindings: TBindings }> }
    & TMethods
  >,
): DefinedWorker<TBindings, TMethods> {
  class GeneratedWorker extends WorkerEntrypoint<InferEnv<{ bindings: TBindings }>> {
    static [META_BRAND] = true as const;
    static __meta = meta;
  }

  for (const key of Object.getOwnPropertyNames(methods)) {
    const desc = Object.getOwnPropertyDescriptor(methods, key)!;
    if (desc.get != null) {
      Object.defineProperty(GeneratedWorker.prototype, key, desc);
    }
    else if (typeof desc.value === 'function') {
      (GeneratedWorker.prototype as any)[key] = desc.value;
    }
  }

  // Cloudflare requires at least one registered event handler.
  // RPC-only workers have no fetch handler, so we add a default 405 stub.
  if (!Object.hasOwn(methods, 'fetch'))
    GeneratedWorker.prototype.fetch = () => new Response('Method Not Allowed', { status: 405 });

  return GeneratedWorker as unknown as DefinedWorker<TBindings, TMethods>;
}

export function isDefinedWorker(value: unknown): value is DefinedWorker {
  return typeof value === 'function'
    && (value as any)[META_BRAND] === true;
}

export function getWorkerMeta<W extends DefinedWorker>(
  worker: W,
): W extends DefinedWorker<infer B> ? WorkerMeta<B> : never {
  return (worker as any).__meta;
}

export type WorkerRPC<W>
  = W extends { readonly __rpc: infer TMethods }
    ? Omit<TMethods, BuiltinHandlerKeys>
    : never;
