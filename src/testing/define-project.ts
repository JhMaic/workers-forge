import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPoolOptions } from './build-pool-options';

export interface DefineVitestProjectOptions {
  /**
   * Short name (`meta.name`) of the worker under test. Matches the directory
   * the kit writes its `wrangler.jsonc` into under `outDir`.
   */
  worker: string;
  /**
   * Directory containing the kit's generated `<worker>/wrangler.jsonc` files.
   * Defaults to `.build` relative to `process.cwd()` — matching
   * `workers-forge build`'s default output. Absolute paths are honored as-is.
   */
  outDir?: string;
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
  /**
   * Optional override for the path to import wrangler from. Defaults to
   * `wrangler`. Resolved from the user's CWD.
   */
  wranglerModule?: string;
  /**
   * Extra miniflare options merged (shallow, top-level only) on top of the
   * kit-managed `workers` (aux discovery) and `durableObjects` (self-binding)
   * entries before being handed to `cloudflareTest`. Use this for test-only
   * bindings, env vars, or per-namespace storage IDs.
   *
   * Common keys: `bindings`, `d1Databases`, `kvNamespaces`, `r2Buckets`,
   * `queueProducers`, `serviceBindings`, `compatibilityDate`,
   * `compatibilityFlags`. The exact shape matches
   * `cloudflareTest`'s `miniflare` option.
   *
   * Cross-worker storage sharing: miniflare keys D1/KV/R2 instances by their
   * id string. To share a D1 between primary and an aux, set
   * `miniflare.d1Databases.<BINDING>` to the id that already appears in the
   * aux's wrangler.jsonc — both workers connect to the same instance.
   *
   * Throws if `workers` or `durableObjects` are passed: those are managed by
   * workers-forge and would overwrite auto-discovered siblings or the DO
   * self-binding.
   */
  miniflare?: Record<string, unknown>;
}

const KIT_MANAGED_MINIFLARE_KEYS = ['workers', 'durableObjects'] as const;

/**
 * Shallow-merge a user-supplied miniflare options object on top of the
 * kit-managed object. Throws if the user supplies any key listed in
 * {@link KIT_MANAGED_MINIFLARE_KEYS}. Exported for unit testing — not part of
 * the package's public surface (not re-exported from `testing/index.ts`).
 */
export function mergeUserMiniflareOptions(
  kit: Record<string, unknown>,
  user: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!user) return { ...kit };
  for (const k of KIT_MANAGED_MINIFLARE_KEYS) {
    if (k in user) {
      throw new Error(
        `[workers-forge/testing] \`miniflare.${k}\` is managed by workers-forge `
        + `and cannot be passed in \`defineVitestProject({ miniflare })\`. `
        + `Remove it from your config.`,
      );
    }
  }
  return { ...kit, ...user };
}

/**
 * Synthesize a vitest config that runs tests inside the workers runtime via
 * `@cloudflare/vitest-pool-workers`, wired to the kit's already-built
 * `<outDir>/<worker>/wrangler.jsonc`. Sibling workers referenced via service
 * bindings or Durable Object `script_name` are auto-registered as auxiliary
 * miniflare workers (via `wrangler.unstable_getMiniflareWorkerOptions`) so
 * cross-worker calls resolve in-process and TS sources are bundled.
 *
 * Usage:
 * ```ts
 * // vitest.config.ts
 * import { defineVitestProject } from 'workers-forge/testing';
 *
 * export default await defineVitestProject({ worker: 'gateway' });
 * ```
 *
 * Prerequisites: the user must run `workers-forge build` (with `--env <name>`
 * if their KitConfig uses envs) before invoking vitest. The helper reads the
 * generated wrangler.jsonc files; it does not call `build()` itself.
 */
export async function defineVitestProject(opts: DefineVitestProjectOptions): Promise<Record<string, unknown>> {
  const outDir = opts.outDir
    ? (isAbsolute(opts.outDir) ? opts.outDir : resolve(process.cwd(), opts.outDir))
    : resolve(process.cwd(), '.build');

  const descriptor = await buildPoolOptions({ outDir, worker: opts.worker });

  // Resolve wrangler from the user's CWD so we don't pin the kit's own dev
  // dependency tree (especially under symlinked dist during local development).
  const wranglerSpec = opts.wranglerModule ?? 'wrangler';
  const wrangler = await loadPackageFromCwd(wranglerSpec) as {
    unstable_getMiniflareWorkerOptions?: (
      configPath: string,
      env?: string,
      options?: unknown,
    ) => { workerOptions: Record<string, unknown>; main?: string };
  };
  const getMfOptions = wrangler.unstable_getMiniflareWorkerOptions;
  if (typeof getMfOptions !== 'function') {
    throw new Error(
      `[workers-forge/testing] wrangler@${wranglerSpec} does not export `
      + `\`unstable_getMiniflareWorkerOptions\`. Upgrade wrangler to >= 4.0.`,
    );
  }

  // Aux workers are loaded directly by miniflare (no Vite/wrangler transform),
  // so TS sources must be pre-bundled. We use esbuild — available transitively
  // through `wrangler` in every workers project — to produce a single ESM
  // string per sibling and hand it to miniflare via the `script` option.
  let esbuild: { build: (opts: unknown) => Promise<{ outputFiles?: { text: string }[] }> } | undefined;
  if (descriptor.siblings.length > 0) {
    esbuild = await loadPackageFromCwd('esbuild') as typeof esbuild;
  }

  const auxWorkers: Record<string, unknown>[] = [];
  for (const sib of descriptor.siblings) {
    const { workerOptions, main } = getMfOptions(sib.configPath);
    const sibDir = dirname(sib.configPath);
    if (!main) {
      throw new Error(
        `[workers-forge/testing] Sibling ${sib.deployedName} has no \`main\` in its wrangler config.`,
      );
    }
    const entryPath = resolve(sibDir, main);
    const result = await esbuild!.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      // Workers runtime built-ins — must remain unbundled.
      external: ['cloudflare:*', 'node:*'],
      write: false,
      // workerd rejects paths that escape `modulesRoot`; the sourceMappingURL
      // comment esbuild emits ends up containing `..` which trips that check.
      sourcemap: false,
      logLevel: 'silent',
    });
    const text = result.outputFiles?.[0]?.text;
    if (!text) {
      throw new Error(
        `[workers-forge/testing] Failed to bundle sibling ${sib.deployedName}: esbuild produced no output.`,
      );
    }
    auxWorkers.push({
      ...workerOptions,
      name: sib.deployedName,
      modules: [
        { type: 'ESModule', path: 'entry.mjs', contents: text },
      ],
    });
  }

  const kitMiniflare: Record<string, unknown> = {};
  if (auxWorkers.length > 0) kitMiniflare.workers = auxWorkers;
  if (descriptor.selfDurableObjectBinding) {
    const { binding, className } = descriptor.selfDurableObjectBinding;
    kitMiniflare.durableObjects = { [binding]: className };
  }
  const miniflare = mergeUserMiniflareOptions(kitMiniflare, opts.miniflare);

  const poolModule = opts.poolModule ?? '@cloudflare/vitest-pool-workers';
  const mod = await loadPackageFromCwd(poolModule) as { cloudflareTest?: (o: unknown) => unknown };
  const cloudflareTest = mod.cloudflareTest;
  if (typeof cloudflareTest !== 'function') {
    throw new Error(
      `[workers-forge/testing] Could not load \`cloudflareTest\` from "${poolModule}". `
      + `Install \`@cloudflare/vitest-pool-workers\` (>= 0.16) as a devDependency.`,
    );
  }

  return {
    plugins: [cloudflareTest({
      wrangler: { configPath: descriptor.mainConfigPath },
      miniflare: Object.keys(miniflare).length > 0 ? miniflare : undefined,
    })],
    test: opts.test ?? {},
  };
}

async function loadPackageFromCwd(name: string): Promise<unknown> {
  const url = resolvePackageFrom(name, process.cwd());
  if (!url) {
    throw new Error(
      `[workers-forge/testing] Could not resolve "${name}" from ${process.cwd()}. `
      + `Make sure it is installed as a devDependency in your project.`,
    );
  }
  return await import(url);
}

/**
 * Walk up the directory tree from `fromDir` looking for
 * `node_modules/<name>/package.json`. Returns the resolved entry file URL for
 * the `"."` export (preferring `import` over `default`/`main`), or null if the
 * package can't be found.
 */
function resolvePackageFrom(name: string, fromDir: string): string | null {
  let dir = resolve(fromDir);
  while (true) {
    const pkgDir = resolve(dir, 'node_modules', name);
    const pkgJson = resolve(pkgDir, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8')) as PackageJson;
        const entry = resolveEntry(pkg);
        if (entry) return pathToFileURL(resolve(pkgDir, entry)).href;
      }
      catch {
        // fall through to the next ancestor
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

interface PackageJson {
  main?: string;
  module?: string;
  exports?: unknown;
}

function resolveEntry(pkg: PackageJson): string | undefined {
  const exp = pkg.exports;
  if (exp && typeof exp === 'object' && !Array.isArray(exp)) {
    const dot = (exp as Record<string, unknown>)['.'];
    if (typeof dot === 'string') return dot;
    if (dot && typeof dot === 'object' && !Array.isArray(dot)) {
      const o = dot as Record<string, unknown>;
      if (typeof o.import === 'string') return o.import;
      if (typeof o.default === 'string') return o.default;
      if (typeof o.require === 'string') return o.require;
    }
  }
  if (typeof exp === 'string') return exp;
  return pkg.module ?? pkg.main;
}
