import type { WorkerRPC } from '../../../../src';
import type Producer from '../producer';
import { defineWorker, service } from '../../../../src';

type ProducerRPC = WorkerRPC<typeof Producer>;

export default defineWorker(
  {
    name: 'consumer',
    bindings: { services: { PROD: service<ProducerRPC>('producer') } },
    triggers: { cron: '*/10 * * * *' },
  },
  {
    async scheduled() {
      await this.env.PROD.greet('x');
    },
  },
);
