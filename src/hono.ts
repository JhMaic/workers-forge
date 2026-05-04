import type { Hono } from 'hono';
import type { InferEnv, WorkerBindings } from './runtime/bindings';
import type { WorkerMeta } from './runtime/define';
import { defineWorker } from './runtime/define';

export interface InferHonoEnv<T extends WorkerMeta> {
  Bindings: InferEnv<{ bindings: T['bindings'] }>;
}

export function defineHonoWorker<
  const TBindings extends WorkerBindings,
  THonoEnv extends { Bindings: InferEnv<{ bindings: TBindings }> },
>(
  meta: WorkerMeta<TBindings>,
  app: Hono<THonoEnv>,
) {
  return defineWorker(meta, {
    fetch(request: Request) {
      // ctx is protected on WorkerEntrypoint but accessible at runtime —
      // this method executes as part of a GeneratedWorker subclass.

      return app.fetch(request, this.env, (this as any).ctx);
    },
  });
}
