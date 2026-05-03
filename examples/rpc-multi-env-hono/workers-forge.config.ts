import { defineConfig } from 'workers-forge/build';

export default defineConfig({
  prefix: 'rpc-hono-demo-',
  modules: ['src/*.ts'],
  dev: {
    ports: { 'api-worker': 8787, 'data-worker': 8788 },
    persistTo: '.wrangler/state',
  },
  envs: [
    { name: 'local', envFile: '.env.local', suffix: '-local' },
    { name: 'stage', envFile: '.env.stage', suffix: '-stage' },
  ],
});
