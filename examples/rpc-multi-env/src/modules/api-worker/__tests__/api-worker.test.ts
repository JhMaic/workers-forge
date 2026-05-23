import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import apiWorker from '..';
import type { WorkerEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv<typeof apiWorker> {}
  }
}

describe('api-worker', () => {
  afterEach(async () => {
    // KV state persists across tests by default. Re-seed before each.
  });

  it('returns 404 for unknown paths', async () => {
    const res = await SELF.fetch('https://x/nope');
    expect(res.status).toBe(404);
  });

  it('/todos returns the current todo via the DATA service binding', async () => {
    // Seed the KV via /todos/add (which goes through the DATA RPC)
    await SELF.fetch('https://x/todos/add');

    const res = await SELF.fetch('https://x/todos');
    expect(res.status).toBe(200);
    const body = await res.json() as { env: string; todos: { text: string } };
    expect(body.env).toBe('local');
    expect(body.todos).toEqual({ text: 'workers-forge' });
  });

  it('exposes APP_ENV from the active build env (.env.local)', async () => {
    const res = await SELF.fetch('https://x/todos');
    const body = await res.json() as { env: string };
    expect(body.env).toBe('local');
  });
});
