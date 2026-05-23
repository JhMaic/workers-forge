import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'hono': 'src/hono.ts',
    'build/index': 'src/build/index.ts',
    'cli/index': 'src/cli/index.ts',
    'testing/index': 'src/testing/index.ts',
    'testing/register': 'src/testing/register.ts',
  },
  format: 'esm',
  dts: false,
  clean: true,
  outDir: 'dist',
  // node_modules are automatically external; list explicit external packages
  external: ['wrangler', 'hono', 'tsx', 'globby', '@cloudflare/vitest-pool-workers', /^cloudflare:/],
  async onSuccess() {
    // loader.mjs is a plain-JS Node module loader hook referenced by path at
    // runtime. Copy it alongside the compiled build output so that the bundled
    // dist/build/index.js can register it via `register('./internal/loader.mjs')`.
    mkdirSync('dist/internal', { recursive: true });
    copyFileSync(
      'src/build/internal/loader.mjs',
      'dist/internal/loader.mjs',
    );
  },
});
