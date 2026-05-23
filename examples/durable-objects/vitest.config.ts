import { defineConfig } from 'vitest/config';
import { defineVitestProject } from 'workers-forge/testing';

const gateway = await defineVitestProject({ worker: 'gateway' });
const counter = await defineVitestProject({ worker: 'counter' });

// Two vitest projects: each runs in its own workerd isolate with its own
// wrangler config. Gateway tests exercise the cross-DO call path; counter
// tests address the DO via the kit's auto-injected self-binding.
export default defineConfig({
  test: {
    projects: [
      {
        ...gateway,
        test: {
          ...(gateway.test as Record<string, unknown> | undefined),
          name: 'gateway',
          include: ['src/modules/gateway/__tests__/**/*.test.ts'],
        },
      },
      {
        ...counter,
        test: {
          ...(counter.test as Record<string, unknown> | undefined),
          name: 'counter',
          include: ['src/modules/counter/__tests__/**/*.test.ts'],
        },
      },
    ],
  },
});
