import type { ScheduledController } from '@cloudflare/workers-types';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('../../src/runtime/entrypoint', () => import('../_stubs/cloudflare-workers'));

const { service } = await import('../../src/runtime/bindings');
const { defineWorker, getWorkerMeta, isDefinedWorker } = await import('../../src/runtime/define');
type WorkerRPC<W> = import('../../src/runtime/define').WorkerRPC<W>;

describe('defineWorker', () => {
  it('returns a class with __meta brand', () => {
    const Worker = defineWorker(
      { name: 'demo', bindings: { vars: { GREETING: 'hi' } } },
      {
        async fetch() { return new Response('ok'); },
      },
    );

    expect(typeof Worker).toBe('function');
    expect(isDefinedWorker(Worker)).toBe(true);
    const meta = getWorkerMeta(Worker);
    expect(meta.name).toBe('demo');
    expect(meta.bindings?.vars?.GREETING).toBe('hi');
  });

  it('attaches methods to the prototype, accessible via instance', async () => {
    const Worker = defineWorker(
      { name: 'demo' },
      {
        async hello(name: string) {
          return `hi ${name}`;
        },
      },
    );

    const fakeCtx = {} as any;
    const fakeEnv = {} as any;
    const instance = new Worker(fakeCtx, fakeEnv);
    expect(await (instance as any).hello('world')).toBe('hi world');
  });

  it('adds a default 405 fetch stub when no fetch is provided', async () => {
    const Worker = defineWorker(
      { name: 'rpc-only' },
      { async doRpc() { return 'result'; } },
    );

    const instance = new Worker({} as any, {} as any);
    const res = await (instance as any).fetch(new Request('https://example.com'));
    expect(res.status).toBe(405);
  });

  it('does not override fetch when explicitly provided', async () => {
    const Worker = defineWorker(
      { name: 'with-fetch' },
      { async fetch() { return new Response('custom', { status: 200 }); } },
    );

    const instance = new Worker({} as any, {} as any);
    const res = await (instance as any).fetch(new Request('https://example.com'));
    expect(res.status).toBe(200);
  });

  it('workerRPC<typeof Worker> exposes only custom methods (no fetch/scheduled)', () => {
    const _Worker = defineWorker(
      { name: 'demo' },
      {
        async fetch() { return new Response('ok'); },
        async scheduled(_c: ScheduledController) {},
        async customRpc(x: number) { return x * 2; },
      },
    );

    type RPC = WorkerRPC<typeof _Worker>;
    expectTypeOf<RPC['customRpc']>().toBeFunction();
  });

  it('typed env: this.env.X for service bindings is callable', () => {
    interface CrawlerRPC { crawl: (name: string) => Promise<string> }
    const Worker = defineWorker(
      {
        name: 'caller',
        bindings: { services: { CRAWLER: service<CrawlerRPC>('crawler') } },
      },
      {
        async run() {
          return this.env.CRAWLER.crawl('x');
        },
      },
    );
    expect(typeof Worker).toBe('function');
  });

  it('copies getter descriptors to the prototype (property, not method)', () => {
    const marker = {};
    const Worker = defineWorker(
      { name: 'demo' },
      {
        get ns() {
          return marker;
        },
      },
    );

    const instance = new Worker({} as any, {} as any);
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), 'ns');
    expect(typeof descriptor?.get).toBe('function');
    expect((instance as any).ns).toBe(marker);
  });

  it('getter receives this = worker instance (can read env)', () => {
    const fakeDB = {};
    const fakeEnv = { DB: fakeDB } as any;
    const Worker = defineWorker(
      { name: 'demo', bindings: { d1_databases: [{ binding: 'DB', database_id: 'id' }] } },
      {
        get db() {
          return (this as any).env.DB;
        },
      },
    );

    const instance = new Worker({} as any, fakeEnv);
    expect((instance as any).db).toBe(fakeDB);
  });

  it('default 405 fetch stub is added when only getters are defined', async () => {
    const Worker = defineWorker(
      { name: 'rpc-only' },
      {
        get ns() {
          return {};
        },
      },
    );

    const instance = new Worker({} as any, {} as any);
    const res = await (instance as any).fetch(new Request('https://example.com'));
    expect(res.status).toBe(405);
  });
});
