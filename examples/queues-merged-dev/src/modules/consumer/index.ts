import { defineWorker } from 'workers-forge';

interface DemoMessage {
  body: string;
  ts: number;
}

export default defineWorker(
  {
    name: 'consumer',
    triggers: {
      queue: {
        consumers: [{ queue: 'demo-queue', max_batch_size: 10, max_batch_timeout: 1 }],
      },
    },
  },
  {
    async fetch(): Promise<Response> {
      return new Response('consumer is queue-only; check the merged dev logs', { status: 200 });
    },
    async queue(batch: MessageBatch<DemoMessage>): Promise<void> {
      for (const msg of batch.messages) {
        console.log(
          `[consumer] queue=${batch.queue} id=${msg.id} body=${msg.body.body} ts=${msg.body.ts}`,
        );
        msg.ack();
      }
    },
  },
);
