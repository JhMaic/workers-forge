import { defineConfig } from 'workers-forge/build';

/**
 * Demonstrates `dev.groups` — co-host a queue producer and consumer in a
 * single `wrangler dev` process so the queue binding resolves in-process.
 *
 * Running `pnpm dev` launches one merged child:
 *   wrangler dev -c .build/producer/wrangler.jsonc -c .build/consumer/wrangler.jsonc \
 *     --port 8787 --persist-to .wrangler/state
 *
 * The producer's HTTP endpoint is at http://127.0.0.1:8787 (the primary port);
 * messages sent there are picked up by the consumer in the same dev session.
 */
export default defineConfig({
  prefix: 'qmdemo-',
  modules: ['src/modules/*/index.ts'],
  dev: {
    groups: {
      'queue-stack': ['producer', 'consumer'],
    },
    ports: {
      'queue-stack': 8787,
    },
    persistTo: '.wrangler/state',
  },
});
