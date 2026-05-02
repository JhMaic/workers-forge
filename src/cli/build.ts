import type { KitConfig } from '../build';
import { build } from '../build/build';

/**
 * Parsed arguments for the `cf-worker-kit build` command.
 */
export interface BuildCliArgs {
  /**
   * Path to `cf-worker-kit.config.ts`.
   * Set via `--config <path>`. Defaults to `cf-worker-kit.config.ts` in the working directory.
   */
  configPath: string;
}

export function parseBuildArgs(own: string[]): BuildCliArgs | { error: string } {
  let configPath = 'cf-worker-kit.config.ts';
  for (let i = 0; i < own.length; i++) {
    const t = own[i]!;
    if (t === '--config') {
      const v = own[i + 1];
      if (!v)
        return { error: '--config requires a path argument' };
      configPath = v;
      i++;
    }
    else { return { error: `Unknown option "${t}"` }; }
  }
  return { configPath };
}

export async function runBuild(opts: KitConfig): Promise<number> {
  await build(opts);
  return 0;
}
