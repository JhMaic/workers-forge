// Stub for `cloudflare:workers` module under Vitest (Node).
// At runtime in workerd this module is provided by the platform.
export class WorkerEntrypoint<Env = unknown> {
  ctx: ExecutionContext;
  env: Env;
  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class DurableObject<Env = unknown> {
  ctx: DurableObjectState;
  env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

interface ExecutionContext {
  waitUntil: (p: Promise<unknown>) => void;
  passThroughOnException: () => void;
}

interface DurableObjectState {
  id: unknown;
  storage: unknown;
}

export const env = {} as unknown;

export abstract class RpcTarget {}
