// THE ONE FILE A REAL USER WRITES.
//
// Module-mode .d.ts (has top-level import), so `declare module` here is an
// augmentation of the existing `@opennextjs/cloudflare` module. This is the
// canonical way to make `getCloudflareContext().env` fully typed from the
// `defineWorkerMeta` source-of-truth.
import type { AppEnv } from './app.meta';

declare module '@opennextjs/cloudflare' {
  interface CloudflareEnv extends AppEnv {}
}
