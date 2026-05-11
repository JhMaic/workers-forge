// THE ONE FILE A REAL USER WRITES.
//
// @opennextjs/cloudflare declares `CloudflareEnv` in the *global* namespace
// (see node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.d.ts).
// So the augmentation is `declare global { interface CloudflareEnv … }`, not
// `declare module "@opennextjs/cloudflare"`.
import type { AppEnv } from './app.meta';

declare global {
  // Merges with @opennextjs/cloudflare's own CloudflareEnv interface.
  interface CloudflareEnv extends AppEnv {}
}
