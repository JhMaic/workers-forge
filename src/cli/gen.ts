import type { KitConfig } from '../build';
import { resolve } from 'node:path';
import { gen } from '../build/gen';

/**
 * Parsed arguments for the `workers-forge gen` command.
 */
export interface GenCliArgs {
  /** Positional: path to the TS file that named-exports `meta`. */
  metaFile: string;
  /** Output path for the generated `wrangler.jsonc`. */
  outFile: string;
  /** Path to `workers-forge.config.ts`. */
  configPath: string;
  /** Active env name (must match an `envs[].name` entry). */
  envName?: string;
}

const USAGE = 'Usage: workers-forge gen <metaFile> --out <path> [--env <name>] [--config <path>]';

export function parseGenArgs(own: string[]): GenCliArgs | { error: string } {
  let metaFile: string | undefined;
  let outFile = './wrangler.jsonc';
  let configPath = 'workers-forge.config.ts';
  let envName: string | undefined;

  for (let i = 0; i < own.length; i++) {
    const t = own[i]!;
    if (t === '--out') {
      const v = own[i + 1];
      if (!v)
        return { error: '--out requires a path argument' };
      outFile = v;
      i++;
    }
    else if (t.startsWith('--out=')) {
      outFile = t.slice('--out='.length);
    }
    else if (t === '--config') {
      const v = own[i + 1];
      if (!v)
        return { error: '--config requires a path argument' };
      configPath = v;
      i++;
    }
    else if (t.startsWith('--config=')) {
      configPath = t.slice('--config='.length);
    }
    else if (t === '--env') {
      const v = own[i + 1];
      if (!v)
        return { error: '--env requires a name argument' };
      envName = v;
      i++;
    }
    else if (t.startsWith('--env=')) {
      envName = t.slice('--env='.length);
    }
    else if (t.startsWith('--')) {
      return { error: `Unknown option "${t}". ${USAGE}` };
    }
    else if (metaFile === undefined) {
      metaFile = t;
    }
    else {
      return { error: `Unexpected positional "${t}". ${USAGE}` };
    }
  }

  if (!metaFile)
    return { error: `metaFile argument is required. ${USAGE}` };

  return { metaFile, outFile, configPath, envName };
}

export async function runGen(args: GenCliArgs, cfg: KitConfig | undefined): Promise<number> {
  // metaFile / outFile are typed on the command line — resolve them against
  // the user's terminal cwd, not against the config file's directory.
  const cmdCwd = process.cwd();
  await gen({
    metaFile: resolve(cmdCwd, args.metaFile),
    outFile: resolve(cmdCwd, args.outFile),
    // `cfg.cwd` (set by the dispatcher to the config file's dir) is used by
    // gen() only for resolving relative `envFile` paths declared in config.
    cwd: cfg?.cwd,
    prefix: cfg?.prefix ?? '',
    baseConfig: cfg?.baseConfig,
    envs: cfg?.envs,
    envName: args.envName,
  });
  return 0;
}
