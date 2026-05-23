import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import producer from '..';
import type { WorkerEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv<typeof producer> {}
  }
}

describe('producer', () => {
  it('GET /send accepts a query string and acknowledges the enqueue', async () => {
    const res = await SELF.fetch('https://x/send?msg=hello');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; sent: string };
    expect(body).toEqual({ ok: true, sent: 'hello' });
  });

  it('GET /send without a msg query string falls back to a timestamp message', async () => {
    const res = await SELF.fetch('https://x/send');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; sent: string };
    expect(body.ok).toBe(true);
    expect(body.sent).toMatch(/^hello @ /);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await SELF.fetch('https://x/nope');
    expect(res.status).toBe(404);
  });
});
