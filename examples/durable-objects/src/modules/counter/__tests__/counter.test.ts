import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import counter from '..';
import type { DurableObjectTestEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends DurableObjectTestEnv<typeof counter, 'COUNTER'> {}
  }
}

describe('counter durable object', () => {
  it('increment accumulates and persists', async () => {
    const stub = env.COUNTER.get(env.COUNTER.idFromName('t1'));
    expect(await stub.increment()).toBe(1);
    expect(await stub.increment(4)).toBe(5);
    expect(await stub.value()).toBe(5);
  });

  it('reset clears the count without touching the wake counter', async () => {
    const stub = env.COUNTER.get(env.COUNTER.idFromName('t2'));
    await stub.increment();
    await stub.increment();
    const wakesBefore = await stub.wakes();
    await stub.reset();
    expect(await stub.value()).toBe(0);
    // wakes is owned by onWake — reset must not touch it.
    expect(await stub.wakes()).toBe(wakesBefore);
  });

  it('onWake fires on cold-start and bumps the wakes counter', async () => {
    // Fresh instance — wakes should be >= 1 after first contact.
    const stub = env.COUNTER.get(env.COUNTER.idFromName('t3'));
    await stub.value();
    expect(await stub.wakes()).toBeGreaterThanOrEqual(1);
  });

  it('each id is isolated from other ids', async () => {
    const a = env.COUNTER.get(env.COUNTER.idFromName('a'));
    const b = env.COUNTER.get(env.COUNTER.idFromName('b'));
    await a.increment();
    await a.increment();
    expect(await a.value()).toBe(2);
    expect(await b.value()).toBe(0);
  });
});
