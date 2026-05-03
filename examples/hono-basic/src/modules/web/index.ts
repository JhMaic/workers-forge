import { Hono } from 'hono';
import { defineHonoWorker, type InferHonoEnv } from 'workers-forge/hono';

const meta = {
  name: 'web',
  bindings: {
    vars: { APP_ENV: 'development' },
  },
} as const;

type Env = InferHonoEnv<typeof meta>;

const todos: { id: number; text: string }[] = [];
let nextId = 1;

const app = new Hono<Env>();

app.get('/', (c) => c.json({ message: 'hono-basic example', env: c.env.APP_ENV }));

app.get('/todos', (c) => c.json({ env: c.env.APP_ENV, todos }));

app.post('/todos', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.text('Bad Request', 400);
  const todo = { id: nextId++, text: text.trim() };
  todos.push(todo);
  return c.json(todo, 201);
});

export default defineHonoWorker(meta, app);
