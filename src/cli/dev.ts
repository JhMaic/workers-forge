import type { KitConfig } from '../build';
import { dev } from '../dev';

/**
 * Parsed arguments for the `cf-worker-kit dev` command.
 */
export interface DevCliArgs {
  /**
   * Path to `cf-worker-kit.config.ts`.
   * Set via `--config <path>`. Defaults to `cf-worker-kit.config.ts` in the working directory.
   */
  configPath: string;
  /**
   * Directory where `wrangler dev` persists local storage (KV, D1, R2, etc.).
   * Set via `--persist-to <path>`. Overrides `DevConfig.persistTo` from the config file.
   */
  persistTo?: string;
  /**
   * Skip the build step and use the existing output directory as-is.
   * Set via `--no-build`.
   */
  skipBuild: boolean;
  /**
   * Named environment to activate (must match an `envs[].name` entry in the config).
   * Set via `--env <name>`. Env values are overlaid on `vars` at build time.
   */
  envName?: string;
  /**
   * Run only the named module(s) instead of all discovered modules.
   * Set via `--app <name>` (repeatable). The name is the module short name
   * (directory segment under `outDir`, without the prefix).
   */
  only: string[];
  /**
   * Extra arguments forwarded verbatim to every `wrangler dev` process.
   * Passed after `--` on the command line: `cf-worker-kit dev -- --remote`.
   */
  passthrough: string[];
}

export function parseDevArgs(own: string[], passthrough: string[]): DevCliArgs | { error: string } {
  let configPath = 'cf-worker-kit.config.ts';
  let persistTo: string | undefined;
  let skipBuild = false;
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
    else if (t === '--persist-to') {
      const v = own[i + 1];
      if (!v)
        return { error: '--persist-to requires a path argument' };
      persistTo = v;
      i++;
    }
    else if (t === '--no-build') {
      skipBuild = true;
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
  return { configPath, persistTo, skipBuild, envName, only, passthrough };
}

export async function runDev(args: DevCliArgs, opts: KitConfig): Promise<number> {
  const r = await dev({
    ...opts,
    persistTo: args.persistTo,
    skipBuild: args.skipBuild,
    envName: args.envName,
    only: args.only,
    wranglerArgs: args.passthrough,
  });
  return r.exitCode;
}
