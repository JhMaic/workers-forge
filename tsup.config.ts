import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'hono': 'src/hono.ts',
    'build/index': 'src/build/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  outDir: 'dist',
  // node_modules are automatically external; list explicit external packages
  external: ['wrangler', 'hono', 'tsx', 'globby', /^cloudflare:/],
  async onSuccess() {
    // loader.mjs is a plain-JS Node module loader hook referenced by path at
    // runtime. Copy it alongside the compiled build output so that the bundled
    // dist/build/index.js can register it via `register('./internal/loader.mjs')`.
    mkdirSync('dist/build/internal', { recursive: true });
    copyFileSync(
      'src/build/internal/loader.mjs',
      'dist/build/internal/loader.mjs',
    );
  },
});
