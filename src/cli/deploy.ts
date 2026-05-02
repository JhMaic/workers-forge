import type { KitConfig } from '../build';
import type { InternalBuildOptions } from '../build/build';
import { build } from '../build/build';
import { deploy } from '../deploy';

/**
 * Parsed arguments for the `workers-forge deploy` command.
 */
export interface DeployCliArgs {
  /**
   * Path to `workers-forge.config.ts`.
   * Set via `--config <path>`. Defaults to `workers-forge.config.ts` in the working directory.
   */
  configPath: string;
  /**
   * Run `build` before deploying.
   * Set via `--build`. Mutually exclusive with `--path`.
   */
  doBuild: boolean;
  /**
   * Deploy from this pre-built output directory instead of the default `outDir`.
   * Set via `--path <dir>`. Mutually exclusive with `--build`.
   */
  path?: string;
  /**
   * Named environment to activate during build (must match an `envs[].name` entry).
   * Set via `--env <name>`. Requires `--build`.
   */
  envName?: string;
  /**
   * Maximum number of workers to deploy in parallel.
   * Set via `--concurrency <n>` (positive integer). Defaults to deploying all workers sequentially.
   */
  concurrency?: number;
  /**
   * Print the full `wrangler deploy` output for each worker instead of a summary line.
   * Set via `--verbose`.
   */
  verbose: boolean;
  /**
   * Extra arguments forwarded verbatim to every `wrangler deploy` process.
   * Passed after `--` on the command line: `workers-forge deploy -- --dry-run`.
   */
  wranglerArgs: string[];
}

export function parseDeployArgs(own: string[], passthrough: string[]): DeployCliArgs | { error: string } {
  let configPath = 'workers-forge.config.ts';
  let doBuild = false;
  let path: string | undefined;
  let envName: string | undefined;
  let concurrency: number | undefined;
  let verbose = false;
  for (let i = 0; i < own.length; i++) {
    const t = own[i]!;
    if (t === '--config') {
      const v = own[i + 1];
      if (!v)
        return { error: '--config requires a path argument' };
      configPath = v;
      i++;
    }
    else if (t === '--build') {
      doBuild = true;
    }
    else if (t === '--path') {
      const v = own[i + 1];
      if (!v)
        return { error: '--path requires a directory argument' };
      path = v;
      i++;
    }
    else if (t === '--env') {
      const v = own[i + 1];
      if (!v)
        return { error: '--env requires a name argument' };
      envName = v;
      i++;
    }
    else if (t === '--concurrency') {
      const v = own[i + 1];
      if (!v)
        return { error: '--concurrency requires a number argument' };
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1)
        return { error: '--concurrency must be a positive integer' };
      concurrency = n;
      i++;
    }
    else if (t === '--verbose') {
      verbose = true;
    }
    else { return { error: `Unknown option "${t}"` }; }
  }
  if (doBuild && path)
    return { error: '--build and --path are mutually exclusive' };
  if (envName && !doBuild)
    return { error: '--env requires --build (env values are baked at build time)' };
  return { configPath, doBuild, path, envName, concurrency, verbose, wranglerArgs: passthrough };
}

export async function runDeploy(args: DeployCliArgs, opts: KitConfig): Promise<number> {
  if (args.doBuild) {
    await build({ ...opts, envName: args.envName } satisfies InternalBuildOptions);
  }
  const result = await deploy({
    ...opts,
    outDir: args.path ?? opts.outDir,
    concurrency: args.concurrency,
    verbose: args.verbose,
    wranglerArgs: args.wranglerArgs,
  });
  return result.failed.length > 0 ? 1 : 0;
}
