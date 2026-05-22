import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('../../src/runtime/entrypoint', () => import('../_stubs/cloudflare-workers'));

const { defineDurableObject, getDurableObjectMeta, isDefinedDurableObject }
  = await import('../../src/runtime/durable-object');
const { durableObject } = await import('../../src/runtime/bindings');
type DurableObjectRPC<D> = import('../../src/runtime/durable-object').DurableObjectRPC<D>;

describe('defineDurableObject', () => {
  it('returns a class with __meta brand', () => {
    const D = defineDurableObject({ name: 'counter' }, {});
    expect(typeof D).toBe('function');
    expect(isDefinedDurableObject(D)).toBe(true);
    const meta = getDurableObjectMeta(D);
    expect(meta.name).toBe('counter');
  });

  it('exposes bindings shape on meta', () => {
    const D = defineDurableObject({
      name: 'counter',
      bindings: { vars: { GREETING: 'hi' } },
    }, {});
    const meta = getDurableObjectMeta(D);
    expect(meta.bindings?.vars?.GREETING).toBe('hi');
  });

  it('attaches methods to prototype, accessible on an instance', async () => {
    const D = defineDurableObject({ name: 'counter' }, {
      async ping(name: string) {
        return `pong ${name}`;
      },
    });
    const fakeCtx = {} as any;
    const fakeEnv = {} as any;
    const instance = new D(fakeCtx, fakeEnv);
    expect(await (instance as any).ping('x')).toBe('pong x');
  });

  it('does NOT auto-inject a fetch stub (DOs are fetch-optional)', () => {
    const D = defineDurableObject({ name: 'counter' }, { async ping() { return 'ok'; } });
    const instance = new D({} as any, {} as any);
    expect((instance as any).fetch).toBeUndefined();
  });

  it('copies getter descriptors to prototype', () => {
    const marker = {};
    const D = defineDurableObject({ name: 'counter' }, {
      get ns() { return marker; },
    });
    const instance = new D({} as any, {} as any);
    expect((instance as any).ns).toBe(marker);
  });

  it('is not a defineWorker product', () => {
    const D = defineDurableObject({ name: 'counter' }, {});
    expect(isDefinedDurableObject(D)).toBe(true);
  });

  it('DurableObjectRPC<typeof D> exposes only user methods', () => {
    const _D = defineDurableObject({ name: 'counter' }, {
      async fetch(_req: Request) { return new Response(); },
      async alarm() {},
      onWake() {},
      async increment(by: number) { return by; },
    });
    type RPC = DurableObjectRPC<typeof _D>;
    expectTypeOf<RPC['increment']>().toBeFunction();
    // fetch/alarm/onWake stripped
    expectTypeOf<RPC>().not.toHaveProperty('fetch');
    expectTypeOf<RPC>().not.toHaveProperty('alarm');
    expectTypeOf<RPC>().not.toHaveProperty('onWake');
  });

  describe('onWake hook', () => {
    it('runs on construction (every wake)', () => {
      const calls: Array<{ ctx: unknown; env: unknown }> = [];
      const D = defineDurableObject({ name: 'counter' }, {
        onWake() {
          calls.push({ ctx: this.ctx, env: this.env });
        },
      });
      const ctx1 = { id: 'a' } as any;
      const env1 = { GREETING: 'hi' } as any;
      void new D(ctx1, env1);
      expect(calls).toHaveLength(1);
      expect(calls[0].ctx).toBe(ctx1);
      expect(calls[0].env).toBe(env1);

      // simulate a second wake — constructor (and onWake) runs again
      void new D({ id: 'a' } as any, env1);
      expect(calls).toHaveLength(2);
    });

    it('this inside onWake can call other user methods', () => {
      const D = defineDurableObject({ name: 'counter' }, {
        onWake() {
          (this as any)._cache = (this as any).computeInitial();
        },
        computeInitial() {
          return 42;
        },
      });
      const instance = new D({} as any, {} as any) as any;
      expect(instance._cache).toBe(42);
    });

    it('is NOT mounted as a prototype method', () => {
      const D = defineDurableObject({ name: 'counter' }, {
        onWake() {},
        async ping() { return 'ok'; },
      });
      expect(typeof (D.prototype as any).ping).toBe('function');
      expect((D.prototype as any).onWake).toBeUndefined();
    });

    it('absent onWake is a no-op', () => {
      const D = defineDurableObject({ name: 'counter' }, {
        async ping() { return 'ok'; },
      });
      expect(() => new D({} as any, {} as any)).not.toThrow();
    });
  });

  it('durableObject() helper produces the expected binding decl', () => {
    expect(durableObject('counter')).toEqual({ scriptName: 'counter' });
    expect(durableObject('counter', 'staging')).toEqual({ scriptName: 'counter', environment: 'staging' });
  });
});
