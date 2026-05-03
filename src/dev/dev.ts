import type {BuildOptions, BuildResult, InternalBuildOptions} from '../build/build';
import {build} from '../build/build';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {globby} from 'globby';
import {parseServiceDeps, resolveClosure} from '../build/internal/deps';
import {
  allocatePorts,
  findFreePort,
  moduleNameFromOutput,
  prefixLineWriter,
  validatePortConfig,
} from '../build/internal/log-prefix';

export interface DevOptions extends BuildOptions {
  /** Overrides `dev.persistTo` from config. */
  persistTo?: string;
  /** Extra args appended to every child's `wrangler dev` invocation. */
  wranglerArgs?: readonly string[];
  /** When true, skip the implicit build step. */
  skipBuild?: boolean;
  /**
   * If provided and non-empty, only the listed module short names (without
   * prefix) and their service-binding dependency closure are spawned.
   * Empty or omitted = spawn all built modules (current behavior).
   */
  only?: readonly string[];
  /**
   * Selects an entry from `envs` (suffix + envFile vars applied at build).
   * Console labels intentionally remain unsuffixed.
   * Incompatible with `skipBuild` because env values are baked at build time.
   */
  envName?: string;
  /**
   * Stagger between child spawns (ms). Tests pass 0. Default 400.
   * @internal
   */
  _spawnDelayMs?: number;
}

export interface DevResult {
  exitCode: number;
}

/** Test seam — production callers should not pass this. */
export interface DevIo {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

const RESERVED_FLAGS = new Set([
  '--port',
  '--inspector-port',
  '--config',
  '-c',
  '--name',
  '--persist-to',
]);

function assertNoReservedPassthrough(args: readonly string[]): void {
  for (const a of args) {
    const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (RESERVED_FLAGS.has(flag)) {
      throw new Error(
        `${flag} is managed by workers-forge per child worker; `
        + `set it via workers-forge.config (dev.ports / dev.persistTo) instead of passthrough args.`,
      );
    }
  }
}

interface SpawnedChild {
  name: string;
  exit: Promise<number>;
  kill: (sig: NodeJS.Signals) => void;
  alive: boolean;
}

/**
 * Returns true when the generated wrangler config declares a top-level
 * `browser` binding (used by cloudflare-playwright). When true, the dev
 * orchestrator injects `X_BROWSER_HEADFUL=false` so local playwright
 * launches in headless mode.
 */
async function outputHasBrowserBinding(outputPath: string): Promise<boolean> {
  try {
    const text = await readFile(outputPath, 'utf8');
    // Strip line/block comments so JSON.parse can handle wrangler.jsonc.
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const parsed = JSON.parse(stripped) as { browser?: unknown };
    return parsed.browser != null && typeof parsed.browser === 'object';
  }
  catch {
    return false;
  }
}

function spawnOne(
  cwd: string,
  output: string,
  port: number,
  inspectorPort: number,
  persistTo: string | undefined,
  extraArgs: readonly string[],
  io: DevIo,
  needsBrowser: boolean,
): SpawnedChild {
  const name = moduleNameFromOutput(output);
  const label = `${name}:${port}`;
  const args = [
    'dev',
    '-c',
    output,
    '--port',
    String(port),
    '--inspector-port',
    String(inspectorPort),
    '--show-interactive-dev-session=false',
    ...(persistTo ? ['--persist-to', persistTo] : []),
    ...extraArgs,
  ];
  // Default headless for cloudflare-playwright; user-set value (in process.env)
  // takes precedence because process.env spreads after the default.
  const browserEnv: NodeJS.ProcessEnv = needsBrowser ? { X_BROWSER_HEADFUL: 'false' } : {};
  const child = spawn('wrangler', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...browserEnv, ...process.env, FORCE_COLOR: '1' },
  });
  const writeOut = prefixLineWriter(label, io.stdout, name);
  const writeErr = prefixLineWriter(label, io.stderr, name);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (d: string) => writeOut(d));
  child.stderr?.on('data', (d: string) => writeErr(d));

  const result: SpawnedChild = {
    name,
    alive: true,
    kill: (sig) => {
      try {
        child.kill(sig);
      }
      catch {
        // already dead
      }
    },
    exit: new Promise<number>((res) => {
      const finish = (code: number) => {
        result.alive = false;
        writeOut.flush();
        writeErr.flush();
        res(code);
      };
      child.on('close', code => finish(code ?? 1));
      child.on('error', () => finish(1));
    }),
  };
  return result;
}

export async function dev(opts: DevOptions, io?: DevIo): Promise<DevResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const outDir = opts.outDir ?? '.build';
  const sink: DevIo = io ?? {
    stdout: (s) => {
      process.stdout.write(s);
    },
    stderr: (s) => {
      process.stderr.write(s);
    },
  };

  let outputs: string[];
  if (opts.skipBuild) {
    if (opts.envName) {
      throw new Error(
        '--env requires a fresh build (env values are baked into wrangler.jsonc); '
        + 'remove --no-build when using --env.',
      );
    }
    const root = isAbsolute(outDir) ? outDir : resolve(cwd, outDir);
    const found = await globby('*/wrangler.jsonc', { cwd: root, absolute: true });
    outputs = found.sort();
    if (outputs.length === 0) {
      throw new Error(
        `No build outputs found under ${resolve(cwd, outDir)}. `
        + `Run \`workers-forge build\` first or omit --no-build.`,
      );
    }
  }
  else {
    // Build must always generate configs
    // for ALL workers so that dep-closure resolution in the spawn step can read
    // every service-binding dependency, even those not in the requested set.
    const buildOpts: InternalBuildOptions = { ...opts, envName: opts.envName, only: undefined };
    const buildResult: BuildResult = await build(buildOpts);
    outputs = buildResult.outputs;
  }

  if (outputs.length === 0)
    return { exitCode: 0 };

  const extraArgs = opts.wranglerArgs ?? [];
  assertNoReservedPassthrough(extraArgs);

  const persistToRaw = opts.persistTo ?? opts.dev?.persistTo;
  const persistTo = persistToRaw
    ? (isAbsolute(persistToRaw) ? persistToRaw : resolve(cwd, persistToRaw))
    : undefined;

  const allNames = outputs.map(moduleNameFromOutput);
  validatePortConfig(allNames, opts.dev?.ports ?? {});
  const ports = await allocatePorts(allNames, opts.dev?.ports ?? {});

  const only = opts.only ?? [];
  if (only.length > 0) {
    const outputByName = new Map(outputs.map(o => [moduleNameFromOutput(o), o]));
    const depsByName = new Map<string, readonly string[]>();
    for (const [name, out] of outputByName) {
      const deps = await parseServiceDeps(out, opts.prefix, name);
      depsByName.set(name, deps);
    }
    const { order } = resolveClosure(only, depsByName);
    outputs = order.map((n) => {
      const out = outputByName.get(n);
      if (!out)
        throw new Error(`unreachable: missing output for ${n}`);
      return out;
    });
  }

  const stagger = opts._spawnDelayMs ?? 400;
  const children: SpawnedChild[] = [];
  for (let idx = 0; idx < outputs.length; idx++) {
    const o = outputs[idx]!;
    const inspectorPort = await findFreePort();
    const needsBrowser = await outputHasBrowserBinding(resolve(cwd, o));
    children.push(
      spawnOne(cwd, o, ports[moduleNameFromOutput(o)]!, inspectorPort, persistTo, extraArgs, sink, needsBrowser),
    );
    if (idx < outputs.length - 1 && stagger > 0)
      await new Promise(r => setTimeout(r, stagger));
  }

  const forward = (sig: NodeJS.Signals) => {
    for (const c of children) {
      if (c.alive)
        c.kill(sig);
    }
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);

  let failTriggered = false;
  for (const c of children) {
    void c.exit.then((code) => {
      if (code !== 0 && !failTriggered) {
        failTriggered = true;
        for (const other of children) {
          if (other !== c && other.alive)
            other.kill('SIGTERM');
        }
      }
    });
  }

  try {
    const codes = await Promise.all(children.map(c => c.exit));
    return { exitCode: codes.reduce((m, c) => Math.max(m, c), 0) };
  }
  finally {
    process.off('SIGINT', forward);
    process.off('SIGTERM', forward);
  }
}
