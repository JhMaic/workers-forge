import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

// Wire the Next.js dev server up to the wrangler dev registry + local
// persist directory so `next dev` can find the `kv-store` worker that the
// `packages/workers` package is running in the other terminal.
//
// `persist.path` mirrors `workers-forge.config.ts`'s `dev.persistTo`. Both
// sides resolving to the same absolute path is what makes KV state coherent
// in local dev. (The path is resolved relative to this config file.)
await initOpenNextCloudflareForDev({
  persist: { path: '../../.wrangler/state' },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin tracing root to the example monorepo. Without this, Next.js may pick
  // a parent lockfile when this example sits inside a larger repo.
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
};

export default nextConfig;
