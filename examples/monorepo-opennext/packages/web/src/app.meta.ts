import type { KvStoreRpc } from '@example/workers';
import { defineWorkerMeta, type InferEnv, service } from 'workers-forge';

// Single source of truth for the Next.js worker's wrangler.jsonc.
// Consumed by `workers-forge gen ./src/app.meta.ts --out ../wrangler.jsonc`.
export const meta = defineWorkerMeta({
  name: 'web',
  bindings: {
    vars: {
      // Plain-text vars are overlaid at build time from the active env's
      // envFile (only keys declared here are written; extras are ignored).
      APP_NAME: '',
      LOG_LEVEL: '',
    },
    services: {
      // Just write the short name. workers-forge gen discovers sibling
      // worker names from the shared config's `modules` glob and rewrites
      // this to `${prefix}kv-store${suffix}` automatically — same behavior
      // as `workers-forge build`.
      KV_STORE: service<KvStoreRpc>('kv-store'),
    },
  },
  // `_raw` is written verbatim — required by @opennextjs/cloudflare.
  _raw: {
    main: '.open-next/worker.js',
    assets: {
      binding: 'ASSETS',
      directory: '.open-next/assets',
    },
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
  },
});

export type AppEnv = InferEnv<typeof meta>;
