import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import dataWorker from '../data-worker';
import type { WorkerEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv<typeof dataWorker> {}
  }
}

describe('data-worker', () => {
  it('returns 405 for HTTP fetch (RPC-only worker)', async () => {
    const res = await SELF.fetch('https://x/anything');
    expect(res.status).toBe(405);
  });

  it('has the expected meta brand', () => {
    expect((dataWorker as { __meta?: { name: string } }).__meta?.name).toBe('data-worker');
  });
});
