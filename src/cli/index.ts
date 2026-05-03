import type { KitConfig } from '../build';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseBuildArgs, runBuild } from './build';
import { parseDeployArgs, runDeploy } from './deploy';
import { parseDevArgs, runDev } from './dev';
import { splitDoubleDash } from './parser';

const USAGE = 'Usage: workers-forge <build|deploy|dev> [options] [-- <wrangler args>]';

interface ConfigModule { default?: KitConfig }

async function loadConfig(p: string): Promise<KitConfig> {
  let mod: ConfigModule;
  try {
    mod = await import(pathToFileURL(p).href);
  }
  catch (err: any) {
    throw new Error(`Failed to load config from ${p}: ${err?.message ?? err}`);
  }
  if (!mod.default)
    throw new Error(`Config file ${p} must default-export a KitConfig (use defineConfig)`);
  return mod.default;
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    console.error(`Missing command. ${USAGE}`);
    return 1;
  }
  const cmd = argv[0];
  if (cmd !== 'build' && cmd !== 'deploy' && cmd !== 'dev') {
    console.error(`Unknown command "${cmd}". ${USAGE}`);
    return 1;
  }
  const { own, passthrough } = splitDoubleDash(argv.slice(1));

  if (cmd === 'build') {
    const parsed = parseBuildArgs(own);
    if ('error' in parsed) {
      console.error(parsed.error);
      return 1;
    }
    const configPath = resolve(parsed.configPath);
    let cfg: KitConfig;
    try {
      cfg = await loadConfig(configPath);
    }
    catch (e: any) {
      console.error(e?.message ?? String(e));
      return 1;
    }
    try {
      return await runBuild(parsed, { ...cfg, cwd: cfg.cwd ?? dirname(configPath) });
    }
    catch (e: any) {
      console.error(e?.message ?? String(e));
      return 1;
    }
  }
  if (cmd === 'deploy') {
    const parsed = parseDeployArgs(own, passthrough);
    if ('error' in parsed) {
      console.error(parsed.error);
      return 1;
    }
    const configPath = resolve(parsed.configPath);
    let cfg: KitConfig;
    try {
      cfg = await loadConfig(configPath);
    }
    catch (e: any) {
      console.error(e?.message ?? String(e));
      return 1;
    }
    try {
      return await runDeploy(parsed, { ...cfg, cwd: cfg.cwd ?? dirname(configPath) });
    }
    catch (e: any) {
      console.error(e?.message ?? String(e));
      return 1;
    }
  }
  // dev
  const parsed = parseDevArgs(own, passthrough);
  if ('error' in parsed) {
    console.error(parsed.error);
    return 1;
  }
  const configPath = resolve(parsed.configPath);
  let cfg: KitConfig;
  try {
    cfg = await loadConfig(configPath);
  }
  catch (e: any) {
    console.error(e?.message ?? String(e));
    return 1;
  }
  try {
    return await runDev(parsed, { ...cfg, cwd: cfg.cwd ?? dirname(configPath) });
  }
  catch (e: any) {
    console.error(e?.message ?? String(e));
    return 1;
  }
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0)
      process.exit(code);
  });
}
