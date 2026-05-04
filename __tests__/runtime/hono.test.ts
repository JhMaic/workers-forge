import type { InferHonoEnv } from '../../src/hono';
import { Hono } from 'hono';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('../../src/runtime/entrypoint', () => import('../_stubs/cloudflare-workers'));

const { service } = await import('../../src/runtime/bindings');
const { getWorkerMeta, isDefinedWorker } = await import('../../src/runtime/define');
const { defineHonoWorker } = await import('../../src/hono');

describe('inferHonoEnv', () => {
  it('maps vars and service bindings to Hono Bindings shape', () => {
    interface CrawlerRPC { crawl: (url: string) => Promise<string> }

    const _meta = {
      name: 'test',
      bindings: {
        vars: { CONVEX_URL: '' },
        services: { CRAWLER: service<CrawlerRPC>('crawler') },
      },
    } as const;

    type Env = InferHonoEnv<typeof _meta>;
    expectTypeOf<Env['Bindings']['CONVEX_URL']>().toBeString();
    expectTypeOf<Env['Bindings']['CRAWLER']['crawl']>().toBeFunction();
  });

  it('yields empty Bindings when meta has no bindings', () => {
    const _meta = { name: 'plain' } as const;
    type Env = InferHonoEnv<typeof _meta>;
    expectTypeOf<Env['Bindings']>().toEqualTypeOf<Record<never, never>>();
  });
});

describe('defineHonoWorker', () => {
  it('returns a branded defineWorker product', () => {
    const meta = { name: 'notify', bindings: { vars: { GREETING: 'hi' } } } as const;
    type Env = InferHonoEnv<typeof meta>;
    const app = new Hono<Env>();
    app.get('/', c => c.text(c.env.GREETING));

    const Worker = defineHonoWorker(meta, app);

    expect(isDefinedWorker(Worker)).toBe(true);
    expect(getWorkerMeta(Worker).name).toBe('notify');
  });

  it('accepts a Hono app that also carries Variables in its type param', () => {
    interface MyVars { userId: string }
    const meta = { name: 'typed', bindings: { vars: { TOKEN: 'x' } } } as const;
    type Env = InferHonoEnv<typeof meta>;
    // Combining Variables with Bindings must compile without error.
    const app = new Hono<Env & { Variables: MyVars }>();
    app.get('/', c => c.text(c.get('userId')));
    expectTypeOf(defineHonoWorker<typeof meta['bindings'], Env & { Variables: MyVars }>)
      .toBeCallableWith(meta, app);
  });

  it('routes requests to Hono handlers using worker env', async () => {
    const meta = { name: 'notify', bindings: { vars: { GREETING: 'hello' } } } as const;
    type Env = InferHonoEnv<typeof meta>;
    const app = new Hono<Env>();
    app.get('/greet/:name', c => c.text(`${c.env.GREETING} ${c.req.param('name')}`));

    const Worker = defineHonoWorker(meta, app);
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    const instance = new Worker(ctx as any, { GREETING: 'hello' } as any);

    const res = await instance.fetch!(new Request('https://worker.test/greet/world'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });
});
