import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import gateway from '..';
import type { WorkerEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv<typeof gateway> {}
  }
}

// Note: pool-workers marks `SELF` as @deprecated and suggests
// `import { exports } from 'cloudflare:workers'` + `exports.default.fetch()`.
// We keep `SELF` because the alternative needs a project-specific
// `Cloudflare.GlobalProps.mainModule` declaration that conflicts when several
// vitest projects coexist under one tsconfig (gateway vs counter here). The
// deprecation hint is informational — `SELF` still works.

describe('gateway worker', () => {
  afterEach(async () => {
    // Persisted DO state survives across tests by default — reset the counter
    // we use so each test starts clean.
    const stub = env.COUNTER.get(env.COUNTER.idFromName('global'));
    await stub.reset();
  });

  it('exposes a 404 for unknown paths', async () => {
    const res = await SELF.fetch('https://x/nope');
    expect(res.status).toBe(404);
  });

  it('/increment routes through the COUNTER DO and bumps the value', async () => {
    const res = await SELF.fetch('https://x/increment');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ n: 1 });
  });

  it('/value reads the count last written by /increment', async () => {
    await SELF.fetch('https://x/increment');
    await SELF.fetch('https://x/increment');
    const res = await SELF.fetch('https://x/value');
    expect(await res.json()).toEqual({ n: 2 });
  });

  it('/wakes reports the DO lifecycle counter set by onWake', async () => {
    await SELF.fetch('https://x/value');
    const res = await SELF.fetch('https://x/wakes');
    const body = await res.json() as { wakes: number };
    expect(body.wakes).toBeGreaterThanOrEqual(1);
  });

  it('/reset clears the persisted count', async () => {
    await SELF.fetch('https://x/increment');
    const reset = await SELF.fetch('https://x/reset');
    expect(await reset.json()).toEqual({ ok: true });
    const value = await SELF.fetch('https://x/value');
    expect(await value.json()).toEqual({ n: 0 });
  });
});
