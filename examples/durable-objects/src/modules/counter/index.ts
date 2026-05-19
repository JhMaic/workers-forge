import {defineDurableObject, type DurableObjectRPC} from 'workers-forge';

const counter = defineDurableObject(
  {
    name: 'counter',
  },
  {
    async increment(by: number = 1): Promise<number> {
      const v = (await this.ctx.storage.get<number>('n')) ?? 0;
      const next = v + by;
      await this.ctx.storage.put('n', next);
      return next;
    },
    async value(): Promise<number> {
      return (await this.ctx.storage.get<number>('n')) ?? 0;
    },
    async reset(): Promise<void> {
      await this.ctx.storage.delete('n');
    },
  },
);

export type CounterRPC = DurableObjectRPC<typeof counter>;
export default counter;
