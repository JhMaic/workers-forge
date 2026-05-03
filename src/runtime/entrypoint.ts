// Re-exports `WorkerEntrypoint` from `cloudflare:workers`.
//
// At runtime in workerd, `cloudflare:workers` is provided by the platform.
// During the kit's build step, a Node module loader (`internal/loader.mjs`) is
// registered to stub `cloudflare:*` specifiers so worker modules can be
// dynamically imported in Node without crashing. Under Vitest, test files
// `vi.mock('cloudflare:workers', ...)` to provide the same stub.
import { RpcTarget as RpcTargetImpl, WorkerEntrypoint as WorkerEntrypointImpl } from 'cloudflare:workers';

export const WorkerEntrypoint = WorkerEntrypointImpl;
// eslint-disable-next-line ts/no-redeclare
export type WorkerEntrypoint<Env = unknown> = WorkerEntrypointImpl<Env>;

export const RpcTarget = RpcTargetImpl;
// eslint-disable-next-line ts/no-redeclare
export type RpcTarget = RpcTargetImpl;
