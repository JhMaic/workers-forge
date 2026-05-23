// Side-effect module: registers the kit's `cloudflare:*` stub loader so that
// downstream static imports of `workers-forge` / `workers-forge/build` in
// vitest config files (which transitively `import 'cloudflare:workers'`) don't
// crash Node with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
//
// Import this BEFORE any other kit import in your vitest.config.ts:
//
//   import 'workers-forge/testing/register';
//   import { defineVitestProject } from 'workers-forge/testing';
//   import kitConfig from './workers-forge.config';
//
// This module deliberately has no kit imports of its own. Its only job is to
// install the loader hook ahead of the kit's import graph.

import { register } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
try {
  // `loader.mjs` is copied alongside the build/deploy chunks at `dist/internal/loader.mjs`
  // via `tsup.config.ts`'s `onSuccess`. From `dist/testing/register.js`, that
  // resolves to `../internal/loader.mjs`.
  register('../internal/loader.mjs', pathToFileURL(`${here}/`));
}
catch (err) {
  console.warn('[workers-forge/testing/register] Failed to register cloudflare:* stub loader', {
    error: String(err),
  });
}
