import { defineWorker } from '../../../../src';

export default defineWorker(
  { name: 'producer', bindings: { vars: { GREETING: 'hi' } } },
  {
    async fetch() { return new Response('producer'); },
    async greet(name: string) { return `hi ${name}`; },
  },
);
