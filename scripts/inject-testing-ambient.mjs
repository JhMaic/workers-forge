// Prepends a triple-slash `<reference types="@cloudflare/vitest-pool-workers/types" />`
// to `dist/testing/index.d.ts` so that any user file importing from
// `workers-forge/testing` automatically gets the `cloudflare:test` ambient
// module declaration loaded — no `env.d.ts` or `compilerOptions.types` entry
// required in the user's project.
//
// tsc strips this directive from emitted `.d.ts` files when nothing from the
// referenced package appears in the output, even though the directive is the
// whole reason the file exists. The simplest robust workaround is to prepend
// it ourselves after tsc has finished.
//
// Run from the `build` npm script after `tsup && tsc --project tsconfig.build.json`.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('dist/testing/index.d.ts');
const directive = '/// <reference types="@cloudflare/vitest-pool-workers/types" />\n';

const current = readFileSync(target, 'utf-8');
if (current.startsWith(directive)) {
  process.exit(0);
}
writeFileSync(target, directive + current, 'utf-8');
