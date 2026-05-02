import type { BuildOptions } from './build';

/**
 * User-facing config type — alias of `BuildOptions` so the kit has a single
 * source of truth for build/deploy configuration.
 */
export type KitConfig = BuildOptions;

/**
 * Identity helper that gives `cf-worker-kit.config.ts` authors full type
 * inference + go-to-definition without affecting runtime behavior.
 *
 * @example
 * import { defineConfig } from '@immi-yoyaku/cf-worker-kit';
 * export default defineConfig({
 *   prefix: 'my-app-',
 *   modules: ['src/modules/{search,api}/index.ts'],
 * });
 */
export function defineConfig(config: KitConfig): KitConfig {
  return config;
}
