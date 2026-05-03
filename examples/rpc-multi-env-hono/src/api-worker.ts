import {Hono} from 'hono';
import {defineHonoWorker, type InferHonoEnv} from 'workers-forge/hono';
import {service} from 'workers-forge';
import type {DataWorkerRPC} from './data-worker';

const meta = {
  name: 'api-worker',
  bindings: {
    vars: { APP_ENV: '' },
    services: { DATA: service<DataWorkerRPC>('data-worker') },
  },
} as const;

const app = new Hono<InferHonoEnv<typeof meta>>();

app.get('/todos', async (c) => {
  const todos = await c.env.DATA.getTodos();
  return c.json({ env: c.env.APP_ENV, todos });
});

app.get('/todos/add', async (c) => {
  await c.env.DATA.addTodo('workers-forge-hono');
  return c.json({ text: 'ok' });
});

export default defineHonoWorker(meta, app);
