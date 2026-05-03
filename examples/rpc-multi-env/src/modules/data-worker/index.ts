import { defineWorker, type WorkerRPC } from 'workers-forge';

const worker = defineWorker(
  {
    name: 'data-worker',
    bindings: {
      vars: { APP_ENV: 'development' },
      d1_databases: [{
        binding: 'DB',
        database_id: process.env.CF_CONFIG_D1_ID ?? '',
        database_name: 'todos' + (process.env.CF_CONFIG_D1_SUFFIX ?? ''),
      }],
    },
  },
  {
    async fetch() {
      return new Response(`data-worker running in: ${this.env.APP_ENV}`);
    },
    async getTodos(): Promise<{ id: number; text: string }[]> {
      const { results } = await this.env.DB.prepare('SELECT id, text FROM todos').all();
      return results as { id: number; text: string }[];
    },
    async addTodo(text: string): Promise<{ id: number; text: string }> {
      const row = await this.env.DB
        .prepare('INSERT INTO todos (text) VALUES (?) RETURNING id, text')
        .bind(text)
        .first<{ id: number; text: string }>();
      return row!;
    },
  },
);

export type DataWorkerRPC = WorkerRPC<typeof worker>;
export default worker;
