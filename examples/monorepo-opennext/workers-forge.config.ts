// Shared workers-forge config — referenced by BOTH packages (`workers` and
// `web`). Keeping `prefix` + `envs` in one file is what makes sibling-name
// composition consistent across packages: when `web` writes
// `service(`${envs.prefix}kv-store${envs.suffix}`)`, the name resolves to
// exactly the worker that `workers-forge dev` is running over in `packages/workers`.
import { defineConfig } from 'workers-forge/build';

export default defineConfig({
  prefix: 'mre-',
  // Only consumed by `workers-forge dev/build/deploy` (workers package). The
  // `web` package uses `workers-forge gen` which ignores `modules`.
  modules: ['packages/workers/src/modules/*/index.ts'],
  // Local dev persist directory. Workers spawned by `workers-forge dev` write
  // their KV/D1 state here; the web package's `next dev` (via OpenNext's
  // dev-bindings integration) should point at the same directory so both
  // sides see the same KV contents during local development.
  dev: {
    persistTo: '.wrangler/state',
  },
  envs: [
    {
      name: 'local',
      envFile: ['.env', '.env.local'],
      suffix: '-local',
    },
    {
      name: 'staging',
      envFile: ['.env', '.env.staging'],
      suffix: '-staging',
    },
    {
      name: 'production',
      envFile: ['.env', '.env.production'],
      // Empty suffix: production names == prefix + base name only.
      suffix: '',
    },
  ],
  baseConfig: {
    compatibility_date: '2026-04-08',
    compatibility_flags: ['nodejs_compat'],
  },
});
