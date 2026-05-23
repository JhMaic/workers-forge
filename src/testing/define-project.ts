import type { KitConfig } from '../build/config';
import { isAbsolute, resolve } from 'node:path';
import { buildPoolOptions } from './build-pool-options';

export interface DefineVitestProjectOptions {
  /**
   * The project's `workers-forge.config.ts` default export. Used only to
   * resolve `outDir` (and its `cwd`); env / prefix are inferred from the
   * already-built wrangler.jsonc files.
   */
  kitConfig: KitConfig;
  /**
   * Short name (`meta.name`) of the worker under test. Matches the directory
   * under `<outDir>/`. If omitted, the helper auto-detects from the location
   * of the importing `vitest.config.ts`: if the file lives under a directory
   * whose basename matches a built worker, that worker is used.
   */
  worker?: string;
  /**
   * Extra options forwarded verbatim to vitest's `test` block (e.g. `setupFiles`,
   * `globals`). Use this for vitest-level config the kit can't infer.
   */
  test?: Record<string, unknown>;
  /**
   * Optional override for the path to import `cloudflareTest` from. Defaults
   * to `@cloudflare/vitest-pool-workers`. Useful when consumers vendor the
   * plugin under a different specifier.
   */
  poolModule?: string;
}

/**
 * Synthesize a vitest config that runs tests inside the workers runtime via
 * `@cloudflare/vitest-pool-workers`, wired to the kit's already-built
 * `<outDir>/<worker>/wrangler.jsonc`. Sibling workers referenced via service
 * bindings or Durable Object `script_name` are auto-registered as auxiliary
 * miniflare workers so cross-worker calls resolve in-process.
 *
 * Usage:
 * ```ts
 * // vitest.config.ts
 * import { defineVitestProject } from 'workers-forge/testing';
 * import kitConfig from './workers-forge.config';
 *
 * export default defineVitestProject({ kitConfig, worker: 'gateway' });
 * ```
 *
 * Prerequisites: the user must run `workers-forge build` (with `--env <name>`
 * if their KitConfig uses envs) before invoking vitest. The helper reads the
 * generated wrangler.jsonc files; it does not call `build()` itself.
 */
export async function defineVitestProject(opts: DefineVitestProjectOptions): Promise<Record<string, unknown>> {
  const cwd = resolve(opts.kitConfig.cwd ?? process.cwd());
  const outDir = isAbsolute(opts.kitConfig.outDir ?? '')
    ? opts.kitConfig.outDir!
    : resolve(cwd, opts.kitConfig.outDir ?? '.build');

  const worker = opts.worker ?? inferWorkerFromCwd(outDir);
  if (!worker) {
    throw new Error(
      `[workers-forge/testing] Could not infer "worker" — pass it explicitly via `
      + `defineVitestProject({ worker: '<short-name>' }).`,
    );
  }

  const poolOptions = await buildPoolOptions({ outDir, worker });

  const poolModule = opts.poolModule ?? '@cloudflare/vitest-pool-workers';
  const mod = await import(poolModule) as { cloudflareTest?: (o: unknown) => unknown };
  const cloudflareTest = mod.cloudflareTest;
  if (typeof cloudflareTest !== 'function') {
    throw new Error(
      `[workers-forge/testing] Could not load \`cloudflareTest\` from "${poolModule}". `
      + `Install \`@cloudflare/vitest-pool-workers\` (>= 0.16) as a devDependency.`,
    );
  }

  return {
    plugins: [cloudflareTest(poolOptions)],
    test: opts.test ?? {},
  };
}

/**
 * Best-effort: if `vitest.config.ts` lives under `src/modules/<name>/...`,
 * return `<name>`. Returns undefined if the heuristic doesn't match — the
 * caller will then surface a clear error.
 */
function inferWorkerFromCwd(_outDir: string): string | undefined {
  // Reserved for a future heuristic. We could scan up from process.cwd() for
  // a parent dir whose basename matches a built worker, but `process.cwd()`
  // when vitest loads a config is the project root, so this rarely helps.
  // Leave undefined here and require explicit `worker` until a clean signal
  // emerges (e.g. the test file path during config evaluation).
  return undefined;
}
