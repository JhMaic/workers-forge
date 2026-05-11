import type { KvStoreRpc } from '@example/workers';
import { defineWorkerMeta, envs, type InferEnv, service } from 'workers-forge';

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
      // Cross-package sibling: the service name must match `kv-store`'s
      // deployed name (`${prefix}kv-store${suffix}`). Because both packages
      // import the same `workers-forge.config.ts`, prefix + suffix are
      // guaranteed identical, so this resolves correctly per env.
      KV_STORE: service<KvStoreRpc>(`${envs.prefix}kv-store${envs.suffix}`),
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
