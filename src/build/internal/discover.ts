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
  return matches.map(m => resolve(opts.cwd, m)).sort();
}
