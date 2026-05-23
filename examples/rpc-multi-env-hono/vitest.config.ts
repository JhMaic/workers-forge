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
          include: ['src/__tests__/api-worker.test.ts'],
        },
      },
      {
        ...data,
        test: {
          ...(data.test as Record<string, unknown> | undefined),
          name: 'data-worker',
          include: ['src/__tests__/data-worker.test.ts'],
        },
      },
    ],
  },
});
