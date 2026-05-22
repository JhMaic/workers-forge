import {defineDurableObject, type DurableObjectRPC} from 'workers-forge';

const counter = defineDurableObject(
  {
    name: 'counter',
  },
  {
    onWake() {
      // Runs on every wake (cold start AND hibernation wake).
      // Pre-load the persisted count into an in-memory field and bump a
      // `wakes` counter so we can observe the lifecycle.
      // blockConcurrencyWhile gates incoming requests until the async load
      // settles, so they all see a populated cache.
      this.ctx.blockConcurrencyWhile(async () => {
        const prevWakes = (await this.ctx.storage.get<number>('wakes')) ?? 0;
        await this.ctx.storage.put('wakes', prevWakes + 1);
        (this as any)._n = (await this.ctx.storage.get<number>('n')) ?? 0;
      });
    },
    async increment(by: number = 1): Promise<number> {
      const next = ((this as any)._n as number) + by;
      (this as any)._n = next;
      await this.ctx.storage.put('n', next);
      return next;
    },
    async value(): Promise<number> {
      // Served from the in-memory cache that onWake populated.
      return (this as any)._n as number;
    },
    async wakes(): Promise<number> {
      return (await this.ctx.storage.get<number>('wakes')) ?? 0;
    },
    async reset(): Promise<void> {
      // Note: `wakes` is intentionally NOT cleared — it's a lifecycle counter
      // owned by onWake, not user-facing state.
      await this.ctx.storage.delete('n');
      (this as any)._n = 0;
    },
  },
);

export type CounterRPC = DurableObjectRPC<typeof counter>;
export default counter;
