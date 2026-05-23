import { defineConfig } from 'vitest/config';
import { defineVitestProject } from 'workers-forge/testing';

// Each worker gets its own vitest project: the producer test verifies
// the HTTP path that enqueues a message; the consumer test exercises
// the queue() handler directly via SELF.queue().
const producer = await defineVitestProject({ worker: 'producer' });
const consumer = await defineVitestProject({ worker: 'consumer' });

export default defineConfig({
  test: {
    projects: [
      {
        ...producer,
        test: {
          ...(producer.test as Record<string, unknown> | undefined),
          name: 'producer',
          include: ['src/modules/producer/__tests__/**/*.test.ts'],
        },
      },
      {
        ...consumer,
        test: {
          ...(consumer.test as Record<string, unknown> | undefined),
          name: 'consumer',
          include: ['src/modules/consumer/__tests__/**/*.test.ts'],
        },
      },
    ],
  },
});
