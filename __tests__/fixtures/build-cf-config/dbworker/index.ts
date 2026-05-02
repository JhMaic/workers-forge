import { defineWorker } from '../../../../src';

export default defineWorker(
  {
    name: 'dbworker',
    bindings: {
      d1_databases: [{ binding: 'DB', database_id: process.env.CF_CONFIG_D1_ID ?? '' }],
    },
  },
  {
    async fetch() { return new Response('ok'); },
  },
);
