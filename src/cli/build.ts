import type { KitConfig } from '../build';
import type { InternalBuildOptions } from '../build/build';
import { build } from '../build/build';

/**
 * Parsed arguments for the `workers-forge build` command.
 */
export interface BuildCliArgs {
  /**
   * Path to `workers-forge.config.ts`.
   * Set via `--config <path>`. Defaults to `workers-forge.config.ts` in the working directory.
   */
  configPath: string;
  /**
   * Named environment to activate (must match an `envs[].name` entry in the config).
   * Set via `--env <name>`. Env values are overlaid on `vars` at build time.
   */
  envName?: string;
  /**
   * Build only the named module(s) instead of all discovered modules.
   * Set via `--app <name>` (repeatable). Other workers' existing outputs are preserved.
   */
  only: string[];
}

export function parseBuildArgs(own: string[]): BuildCliArgs | { error: string } {
  let configPath = 'workers-forge.config.ts';
  let envName: string | undefined;
  const only: string[] = [];
  for (let i = 0; i < own.length; i++) {
    const t = own[i]!;
    if (t === '--config') {
      const v = own[i + 1];
      if (!v)
        return { error: '--config requires a path argument' };
      configPath = v;
      i++;
    }
    else if (t === '--app') {
      const v = own[i + 1];
      if (!v)
        return { error: '--app requires a name argument' };
      only.push(v);
      i++;
    }
    else if (t === '--env') {
      const v = own[i + 1];
      if (!v)
        return { error: '--env requires a name argument' };
      envName = v;
      i++;
    }
    else { return { error: `Unknown option "${t}"` }; }
  }
  return { configPath, envName, only };
}

export async function runBuild(args: BuildCliArgs, opts: KitConfig): Promise<number> {
  await build({ ...opts, envName: args.envName, only: args.only } satisfies InternalBuildOptions);
  return 0;
}
