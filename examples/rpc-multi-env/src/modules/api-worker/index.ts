import { defineWorker, service } from 'workers-forge';
import type { DataWorkerRPC } from '../data-worker';

export default defineWorker(
  {
    name: 'api-worker',
    bindings: {
      vars: { APP_ENV: '' },
      services: { DATA: service<DataWorkerRPC>('data-worker') },
    },
  },
  {
    async fetch(request: Request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/todos' && request.method === 'GET') {
        const todos = await this.env.DATA.getTodos();
        return Response.json({ env: this.env.APP_ENV, todos });
      }

      if (pathname === '/todos' && request.method === 'POST') {
        const body = await request.json<{ text?: string }>();
        if (!body.text) return new Response('Bad Request', { status: 400 });
        const todo = await this.env.DATA.addTodo(body.text);
        return Response.json(todo, { status: 201 });
      }

      return new Response('Not Found', { status: 404 });
    },
  },
);
