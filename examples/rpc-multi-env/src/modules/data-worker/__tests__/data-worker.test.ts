import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import dataWorker from '..';
import type { WorkerEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv<typeof dataWorker> {}
  }
}

// data-worker is RPC-only — the kit gives it a 405 fetch stub by default.
// Exercise it via the kit's `exports.default` (the generated worker class).
describe('data-worker', () => {
  it('returns 405 for HTTP fetch (no `fetch` handler in defineWorker)', async () => {
    const res = await SELF.fetch('https://x/anything');
    expect(res.status).toBe(405);
  });

  it('module exports the generated worker class with __meta brand', () => {
    expect(typeof dataWorker).toBe('function');
    expect((dataWorker as { __meta?: { name: string } }).__meta?.name).toBe('data-worker');
  });
});
