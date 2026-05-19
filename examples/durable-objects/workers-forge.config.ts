import { defineConfig } from 'workers-forge/build';

export default defineConfig({
  prefix: 'do-demo-',
  modules: ['src/modules/*/index.ts'],
  dev: {
    ports: { gateway: 8787, counter: 8788 },
    persistTo: '.wrangler/state',
  },
  envs: [
    { name: 'local', envFile: '.env.local', suffix: '-local' },
    { name: 'stage', envFile: '.env.stage', suffix: '-stage' },
  ],
});
