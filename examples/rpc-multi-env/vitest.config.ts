import { defineConfig } from 'vitest/config';
import { defineVitestProject } from 'workers-forge/testing';

const api = await defineVitestProject({ worker: 'api-worker' });
const data = await defineVitestProject({ worker: 'data-worker' });

export default defineConfig({
  test: {
    projects: [
      {
        ...api,
        test: {
          ...(api.test as Record<string, unknown> | undefined),
          name: 'api-worker',
          include: ['src/modules/api-worker/__tests__/**/*.test.ts'],
        },
      },
      {
        ...data,
        test: {
          ...(data.test as Record<string, unknown> | undefined),
          name: 'data-worker',
          include: ['src/modules/data-worker/__tests__/**/*.test.ts'],
        },
      },
    ],
  },
});
