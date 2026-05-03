import { defineConfig } from 'workers-forge/build';

export default defineConfig({
  prefix: 'hono-demo-',
  modules: ['src/modules/*/index.ts'],
  dev: {
    ports: { web: 8787 },
  },
});
