import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./__tests__/_stubs/cloudflare-workers.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test-d.ts'],
    typecheck: {
      enabled: true,
      include: ['__tests__/**/*.test-d.ts'],
    },
  },
});
