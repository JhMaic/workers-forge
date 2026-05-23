import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import apiWorker from '../api-worker';
import type { WorkerEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv<typeof apiWorker> {}
  }
}

describe('api-worker (hono)', () => {
  it('GET /todos pulls from the DATA service binding (workers-forge-hono)', async () => {
    // /todos/add seeds the KV via the DATA RPC
    await SELF.fetch('https://x/todos/add');

    const res = await SELF.fetch('https://x/todos');
    expect(res.status).toBe(200);
    const body = await res.json() as { env: string; todos: { text: string } };
    expect(body.env).toBe('local');
    expect(body.todos).toEqual({ text: 'workers-forge-hono' });
  });

  it('hono router returns 404 for unknown paths', async () => {
    const res = await SELF.fetch('https://x/nope');
    expect(res.status).toBe(404);
  });
});
