import { defineWorker, envs } from '../../../../src';

export default defineWorker(
  {
    name: 'worker',
    bindings: {
      d1_databases: [{ binding: 'DB', database_id: 'placeholder', database_name: `mydb${envs.suffix}` }],
    },
  },
  {
    async fetch() { return new Response('ok'); },
  },
);
