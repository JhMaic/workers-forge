import { resolve } from 'node:path';
import { globby } from 'globby';

export interface DiscoverOptions {
  cwd: string;
  modules: readonly string[];
}

export async function discoverModuleFiles(opts: DiscoverOptions): Promise<string[]> {
  const matches = await globby([...opts.modules], {
    cwd: opts.cwd,
    onlyFiles: true,
    absolute: false,
    gitignore: false,
  });
  // Always drop `.d.ts` files — they're type-only and have no runtime default
  // export to validate. Users who set custom module globs like `src/*.ts` will
  // otherwise pick up ambient declarations (e.g. an env.d.ts beside their
  // worker modules) and trip validation.
  return matches
    .filter(m => !m.endsWith('.d.ts'))
    .map(m => resolve(opts.cwd, m))
    .sort();
}
