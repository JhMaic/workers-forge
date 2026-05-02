import type {
  D1Database,
  Fetcher,
  KVNamespace,
} from '@cloudflare/workers-types';
import type { InferEnv, ServiceStub, WorkerBindings } from '../../src/runtime/bindings';
import { RpcTarget } from 'cloudflare:workers';
import { describe, expectTypeOf, it } from 'vitest';
import { service } from '../../src/runtime/bindings';

interface CrawlerRPC {
  crawl: (name: string) => Promise<{ ok: true }>;
}

describe('inferEnv', () => {
  it('infers KV, D1, vars, and service bindings with RPC type', () => {
    const _bindings = {
      kv_namespaces: [{ binding: 'CACHE', id: 'abc' }],
      d1_databases: [{ binding: 'DB', database_id: 'xyz' }],
      services: { CRAWLER: service<CrawlerRPC>('crawler') },
      vars: { GREETING: 'hi' },
    } as const satisfies WorkerBindings;

    type Env = InferEnv<{ bindings: typeof _bindings }>;

    expectTypeOf<Env['CACHE']>().toEqualTypeOf<KVNamespace>();
    expectTypeOf<Env['DB']>().toEqualTypeOf<D1Database>();
    expectTypeOf<Env['CRAWLER']>().toEqualTypeOf<ServiceStub<CrawlerRPC>>();
    expectTypeOf<Env['GREETING']>().toBeString();
  });

  it('infers Fetcher when service has no RPC type', () => {
    const _bindings = {
      services: { PLAIN: { service: 'plain' } },
    } as const satisfies WorkerBindings;

    type Env = InferEnv<{ bindings: typeof _bindings }>;
    expectTypeOf<Env['PLAIN']>().toEqualTypeOf<Fetcher>();
  });

  it('returns empty object for undefined bindings', () => {
    type Env = InferEnv<{ bindings: undefined }>;
    expectTypeOf<Env>().toEqualTypeOf<Record<never, never>>();
  });
});

describe('serviceStub pipelining', () => {
  it('rpcTarget-returning method is pipeable without intermediate await', () => {
    class SubService extends RpcTarget {
      async listItems(): Promise<string[]> {
        return [];
      }
    }

    interface SubRPC {
      sub: () => SubService;
    }

    type Stub_ = ServiceStub<SubRPC>;

    // sub() returns Result<SubService> = Promise<Stub<SubService>> & Provider<SubService>
    // Provider<SubService> exposes listItems directly — no intermediate await needed.
    type SubCallResult = ReturnType<Stub_['sub']>;

    // Must be awaitable (Promise half of Result<SubService>)
    expectTypeOf<SubCallResult>().toMatchTypeOf<PromiseLike<unknown>>();

    // Must have listItems accessible (Provider half — pipelining)
    expectTypeOf<SubCallResult>().toHaveProperty('listItems');
  });
});
