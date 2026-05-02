import type { InferHonoEnv } from '../../../../src/hono';
import { Hono } from 'hono';
import { defineHonoWorker } from '../../../../src/hono';

const meta = {
  name: 'hono',
  bindings: { vars: { GREETING: 'hi' } },
} as const;

type Env = InferHonoEnv<typeof meta>;
const app = new Hono<Env>();
app.get('/hello', c => c.text(c.env.GREETING));

export default defineHonoWorker(meta, app);
