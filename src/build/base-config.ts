import type { Unstable_RawEnvironment } from 'wrangler';

/**
 * Wrangler config fields merged into every generated `wrangler.jsonc`.
 * All standard wrangler.jsonc fields are accepted; the kit manages `name` and
 * `main` automatically (setting them here has no effect).
 *
 * Module-specific bindings and triggers declared via `defineWorker` always win
 * on conflict.
 *
 * @see https://developers.cloudflare.com/workers/wrangler/configuration/
 */
export type BaseConfig = Omit<Unstable_RawEnvironment, 'name' | 'main'>;

/**
 * Default wrangler config fields merged into every generated wrangler.jsonc.
 * Module-specific bindings/triggers always win on conflict.
 */
export const defaultBaseConfig: BaseConfig = {
  compatibility_date: '2026-04-08',
  compatibility_flags: ['nodejs_compat'],
  observability: {
    logs: { enabled: true, invocation_logs: true },
  },
};
