import { createExecutionContext, createMessageBatch, env, getQueueResult, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import consumer from '..';
import type { WorkerEnv } from 'workers-forge/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv<typeof consumer> {}
  }
}

interface DemoMessage {
  body: string;
  ts: number;
}

describe('consumer', () => {
  it('GET / returns the queue-only stub response', async () => {
    const res = await SELF.fetch('https://x/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('consumer is queue-only; check the merged dev logs');
  });

  it('queue() acks every message in the batch', async () => {
    const batch = createMessageBatch<DemoMessage>('demo-queue', [
      { id: 'a', timestamp: new Date(0), attempts: 1, body: { body: 'one', ts: 1 } },
      { id: 'b', timestamp: new Date(0), attempts: 1, body: { body: 'two', ts: 2 } },
    ]);
    const ctx = createExecutionContext();
    // The test target's queue() is on the WorkerEntrypoint subclass prototype.
    // Instantiate it and invoke directly so the batch's ack flags are mutated
    // in this isolate (SELF.queue would cross an RPC boundary and the
    // QueueMessage is not serializable).
    const instance = new (consumer as new (ctx: unknown, env: unknown) => { queue: (b: unknown) => Promise<void> })(ctx, env);
    await instance.queue(batch);
    const result = await getQueueResult(batch, ctx);
    await waitOnExecutionContext(ctx);
    expect(result.outcome).toBe('ok');
    expect(result.ackAll).toBe(false);
    expect(new Set(result.explicitAcks)).toEqual(new Set(['a', 'b']));
    expect(result.retryBatch).toEqual({ retry: false });
  });
});
