import { defineWorker, durableObject } from 'workers-forge';
import type { CounterRPC } from '../counter';

export default defineWorker(
  {
    name: 'gateway',
    bindings: {
      durable_objects: {
        COUNTER: durableObject<CounterRPC>('counter'),
      },
    },
  },
  {
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      const stub = this.env.COUNTER.get(this.env.COUNTER.idFromName('global'));

      if (pathname === '/increment')
        return Response.json({ n: await stub.increment() });
      if (pathname === '/value')
        return Response.json({ n: await stub.value() });
      if (pathname === '/wakes')
        return Response.json({ wakes: await stub.wakes() });
      if (pathname === '/reset') {
        await stub.reset();
        return Response.json({ ok: true });
      }
      return new Response('try /increment, /value, /wakes, /reset', { status: 404 });
    },
  },
);
