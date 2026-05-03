import {defineWorker, type WorkerRPC} from 'workers-forge';

const worker = defineWorker(
  {
    name: 'data-worker',
    bindings: {
      kv_namespaces: [
        {
          binding: 'KV',
          id: process.env.CF_CONFIG_KV_ID!
        }
      ],
    },
  },
  {

    async getTodos(): Promise<{ text: string }> {
      const r = await this.env.KV.get('TODO');
      return { text: r ??'' };
    },
    async addTodo(text: string): Promise<void> {
      await this.env.KV.put('TODO', text)
    },
  },
);

export type DataWorkerRPC = WorkerRPC<typeof worker>;
export default worker;
