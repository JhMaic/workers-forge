// EXAMPLE-ONLY STUB. In a real project this file does NOT exist — the
// `@opennextjs/cloudflare` package itself declares `CloudflareEnv` and
// `getCloudflareContext`. We provide this stub so the example typechecks
// without actually installing @opennextjs/cloudflare and its dependencies.
//
// Script-mode .d.ts (no top-level imports) — `declare module` here declares
// a new ambient module, which is required because we're standing in for a
// non-installed package.

declare module '@opennextjs/cloudflare' {
  // eslint-disable-next-line ts/no-empty-object-type
  interface CloudflareEnv {}
  function getCloudflareContext(): { env: CloudflareEnv };
}
