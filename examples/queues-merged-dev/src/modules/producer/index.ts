import { defineWorker } from 'workers-forge';

export default defineWorker(
  {
    name: 'producer',
    bindings: {
      queues: {
        producers: [{ binding: 'DEMO_QUEUE', queue: 'demo-queue' }],
      },
    },
  },
  {
    async fetch(request: Request): Promise<Response> {
      const { pathname, searchParams } = new URL(request.url);
      if (pathname === '/send') {
        const body = searchParams.get('msg') ?? `hello @ ${new Date().toISOString()}`;
        await this.env.DEMO_QUEUE.send({ body, ts: Date.now() });
        return Response.json({ ok: true, sent: body });
      }
      return new Response('try /send?msg=<text>', { status: 404 });
    },
  },
);
