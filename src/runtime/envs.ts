/**
 * Build-time injected environment context.
 *
 * These fields are set by the cf-worker-kit build pipeline *before* your worker
 * module files are imported. You can reference them inside `defineWorker` to
 * construct environment-specific resource names at build time.
 *
 * @example
 * ```ts
 * import { defineWorker, envs } from '@immi-yoyaku/cf-worker-kit';
 *
 * export default defineWorker({
 *   name: 'db-service',
 *   bindings: {
 *     d1_databases: [{ binding: 'DB', database_id: '...', database_name: 'mydb' + envs.suffix }],
 *   },
 * }, { ... });
 * ```
 *
 * Both fields default to `''` so code works without null-checks when no env is
 * active (plain `build` with no `--env` flag).
 */
export const envs: { suffix: string; prefix: string } = {
  /** Suffix appended to resource names to isolate environments (e.g. `"-staging"`). */
  suffix: '',
  /** Worker name prefix from `cf-worker-kit.config.ts` (e.g. `"my-app-"`). */
  prefix: '',
};
