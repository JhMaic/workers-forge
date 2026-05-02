# @immi-yoyaku/cf-worker-kit

Convention-driven build, dev, and deploy tooling for Cloudflare Workers monorepos.

Declare your workers and bindings once in TypeScript — the kit generates `wrangler.jsonc` per module, gives you fully-typed `this.env.*` access without any manual configuration, and orchestrates `wrangler dev` / `wrangler deploy` across all workers at once.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Defining Workers](#defining-workers)
  - [Bindings reference](#bindings-reference)
  - [Worker triggers](#worker-triggers)
  - [Typed environment (`InferEnv`)](#typed-environment-inferenv)
- [Hono Adapter](#hono-adapter)
- [Service Bindings & RPC](#service-bindings--rpc)
  - [Promise pipelining](#promise-pipelining)
- [Config Reference](#config-reference)
  - [KitConfig fields](#kitconfig-fields)
  - [Shared wrangler config (`baseConfig`)](#shared-wrangler-config-baseconfig)
- [Multi-Environment](#multi-environment)
  - [Runtime variable overrides (`vars`)](#runtime-variable-overrides-vars)
  - [Infrastructure IDs (`CF_CONFIG_*`)](#infrastructure-ids-cf_config_)
  - [Build-time env context (`envs`)](#build-time-env-context-envs)
- [CLI Reference](#cli-reference)
  - [build](#build)
  - [dev](#dev)
  - [deploy](#deploy)
- [Build Output](#build-output)
- [Subpath Exports](#subpath-exports)
- [Development](#development)

---

## Overview

In a Cloudflare Workers monorepo, every worker normally demands its own handwritten `wrangler.jsonc` and a matching TypeScript env type that must be kept in sync with it — forever. Add a KV namespace, update two files. Rename a service binding, hunt down every reference. `cf-worker-kit` collapses that duplication: you declare a worker once in TypeScript and the kit generates the config files and infers all the types for you.

**What you get:**

- **Zero-duplication config** — `defineWorker(meta, methods)` is the single source of truth. `cf-worker-kit build` generates a ready-to-use `wrangler.jsonc` for each module; you never write or edit those files manually.
- **Fully-typed `this.env` for free** — binding declarations are inferred into precise `this.env` types at compile time. Add a D1 binding and `this.env.DB` is immediately a `D1Database` — no separate type file, no cast.
- **Typed cross-worker RPC** — `service<MyWorkerRPC>('worker-name')` attaches the target worker's method signatures to the binding, giving you full IntelliSense and type checking on every inter-worker call.
- **Automatic sibling rewrites** — service bindings that point to other workers in the same project are automatically rewritten to their full deployed name (`prefix + name + suffix`). You write short names in source; the kit handles the rest.
- **One-command local dev** — `cf-worker-kit dev` starts every worker in parallel with its own port; output is labelled `[name:port]`. Use `--app api` to bring up only a worker and its local dependencies.
- **Dependency-aware deployment** — `cf-worker-kit deploy` builds a DAG from service bindings and deploys in the correct order. A failing worker skips only its transitive dependents; unrelated workers continue.
- **Multi-environment without duplication** — declare `envs` once in the config file. Per-env infrastructure IDs (`CF_CONFIG_*`) and runtime variable overrides are injected at build time; the same source tree deploys to staging and production.

The mental model is straightforward:

```
defineWorker(meta, methods)
       │
  cf-worker-kit build
       │
  .build/<name>/wrangler.jsonc   ← handed to wrangler
  InferEnv<typeof meta>          ← used by TypeScript
```

---

## Installation

```sh
pnpm add -D @immi-yoyaku/cf-worker-kit wrangler tsx
```

`wrangler` and `tsx` are peer dependencies and must be installed explicitly. If you use the [Hono adapter](#hono-adapter), also add `hono`:

```sh
pnpm add -D hono
```

---

## Quick Start

**1. Create a config file** at the project root:

```ts
// cf-worker-kit.config.ts
import { defineConfig } from '@immi-yoyaku/cf-worker-kit/build';

export default defineConfig({
  prefix: 'my-app-',
  modules: ['src/modules/*/index.ts'],
});
```

**2. Write a worker module** (`src/modules/api/index.ts`):

```ts
import { defineWorker } from '@immi-yoyaku/cf-worker-kit';

const meta = {
  name: 'api',
  bindings: {
    vars: { GREETING: 'Hello' },
    kv_namespaces: [{ binding: 'CACHE', id: 'your-kv-id' }],
  },
} as const;

export default defineWorker(meta, {
  async fetch(request) {
    const cached = await this.env.CACHE.get('key'); // typed KVNamespace
    return new Response(this.env.GREETING);          // typed string
  },
});
```

**3. Add CLI scripts** to `package.json`:

```json
{
  "scripts": {
    "build":  "cf-worker-kit build",
    "dev":    "cf-worker-kit dev",
    "deploy": "cf-worker-kit deploy --build"
  }
}
```

**4. Run**:

```sh
pnpm build    # generates .build/<name>/wrangler.jsonc for each module
pnpm dev      # starts all workers with wrangler dev
pnpm deploy   # build + deploy to Cloudflare
```

---

## Defining Workers

Workers are declared with `defineWorker(meta, methods)`:

```ts
import { defineWorker } from '@immi-yoyaku/cf-worker-kit';

export default defineWorker(
  {
    name: 'my-worker',        // short name; prefix is added at build time
    bindings: { … },          // see Bindings reference below
    triggers: { … },          // see Worker triggers below
  },
  {
    // Worker methods — all handlers and RPC methods go here.
    // `this` is typed as WorkerEntrypoint with fully-typed this.env.
    async fetch(request: Request) {
      return new Response('ok');
    },
    async myRpcMethod(arg: string): Promise<string> {
      return `hello ${arg}`;
    },
  },
);
```

> **Worker names** must match `[a-z0-9-]+` and the final deployed name (`prefix` + `name` + optional `suffix`) must not exceed 63 characters.

### Bindings reference

All fields are optional. Each field corresponds directly to a top-level section in the generated `wrangler.jsonc`.

| Field | TypeScript type | Runtime type | wrangler.jsonc key |
|---|---|---|---|
| `vars` | `Record<string, string>` | `string` | `vars` |
| `kv_namespaces` | `{ binding, id, preview_id? }[]` | `KVNamespace` | `kv_namespaces` |
| `d1_databases` | `{ binding, database_id, database_name? }[]` | `D1Database` | `d1_databases` |
| `r2_buckets` | `{ binding, bucket_name }[]` | `R2Bucket` | `r2_buckets` |
| `services` | `Record<string, ServiceBindingDecl>` | `ServiceStub<RPC>` | `services` |
| `queues.producers` | `{ binding, queue }[]` | `Queue` | `queues.producers` |
| `ai` | `{ binding }` | `Ai` | `ai` |
| `secrets_store_secrets` | `{ binding, store_id, secret_name }[]` | `SecretsStoreSecret` | `secrets_store_secrets` |
| `vectorize` | `{ binding, index_name }[]` | `VectorizeIndex` | `vectorize` |
| `browser` | `{ binding }` | `Fetcher` | `browser` |
| `analytics_engine_datasets` | `{ binding, dataset? }[]` | `AnalyticsEngineDataset` | `analytics_engine_datasets` |
| `hyperdrive` | `{ binding, id }[]` | `Hyperdrive` | `hyperdrive` |
| `send_email` | `SendEmailDecl[]` | (send method) | `send_email` |

**Example — multiple bindings:**

```ts
const meta = {
  name: 'api',
  bindings: {
    vars: { API_URL: 'https://api.example.com' },
    kv_namespaces:  [{ binding: 'CACHE',  id: 'abc123' }],
    d1_databases:   [{ binding: 'DB',     database_id: 'def456' }],
    r2_buckets:     [{ binding: 'ASSETS', bucket_name: 'my-bucket' }],
    ai:             { binding: 'AI' },
    vectorize:      [{ binding: 'VECTORS', index_name: 'my-index' }],
  },
} as const;
```

### Worker triggers

Triggers define how the worker is *invoked*, not what it *binds to*.

```ts
const meta = {
  name: 'processor',
  triggers: {
    // Cron — runs on a schedule
    cron: '0 * * * *',
    // or multiple: cron: ['0 * * * *', '30 * * * *'],

    // Queue consumer — triggered by incoming queue messages
    queue: {
      consumers: [{
        queue: 'my-queue',
        max_batch_size: 10,
        max_batch_timeout: 5,
        max_retries: 3,
        dead_letter_queue: 'my-queue-dlq',
        retry_delay: 60,
      }],
    },

    // Tail consumer — receives tail events from another worker
    tail: {
      producers: [{ service: 'api' }],
    },
  },
} as const;
```

> **Queue producer vs consumer:** Use `bindings.queues.producers` to *send* messages; use `triggers.queue.consumers` to *receive* them.

### Typed environment (`InferEnv`)

`this.env` is automatically typed based on your `bindings` declaration. You can also export the env type for use elsewhere:

```ts
import type { InferEnv } from '@immi-yoyaku/cf-worker-kit';

const meta = { name: 'api', bindings: { vars: { TOKEN: '' } } } as const;

type Env = InferEnv<typeof meta>; // { TOKEN: string }
```

---

## Hono Adapter

For Hono-based workers, use `defineHonoWorker` from the `./hono` subpath:

```ts
// src/modules/web/index.ts
import { Hono } from 'hono';
import { defineHonoWorker, type InferHonoEnv } from '@immi-yoyaku/cf-worker-kit/hono';

const meta = {
  name: 'web',
  bindings: {
    vars: { GREETING: 'Hello' },
    kv_namespaces: [{ binding: 'CACHE', id: 'abc123' }],
  },
} as const;

// Pass meta as the Hono generic so c.env is fully typed
const app = new Hono<InferHonoEnv<typeof meta>>();

app.get('/hello', async (c) => {
  const cached = await c.env.CACHE.get('key'); // KVNamespace
  return c.text(c.env.GREETING);               // string
});

export default defineHonoWorker(meta, app);
```

---

## Service Bindings & RPC

Workers communicate via [Cloudflare service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/). The kit gives service stubs a typed RPC interface so callers get autocomplete and type checking.

**1. Export the RPC type from the target worker:**

```ts
// src/modules/db-service/index.ts
import { defineWorker, type WorkerRPC } from '@immi-yoyaku/cf-worker-kit';

const worker = defineWorker(
  { name: 'db-service', bindings: {} },
  {
    async getUser(id: string): Promise<{ id: string; name: string } | null> {
      return null; // real implementation here
    },
  },
);

export type DbServiceRPC = WorkerRPC<typeof worker>;
// ^ { getUser(id: string): Promise<{ id: string; name: string } | null> }

export default worker;
```

**2. Bind the target worker using `service<RPC>()`:**

```ts
// src/modules/api/index.ts
import { defineWorker, service } from '@immi-yoyaku/cf-worker-kit';
import type { DbServiceRPC } from '../db-service';

export default defineWorker(
  {
    name: 'api',
    bindings: {
      // The Record key ('DB_SERVICE') becomes the binding name in wrangler.jsonc
      // and in this.env. Pass the RPC type as a generic for IntelliSense.
      services: { DB_SERVICE: service<DbServiceRPC>('db-service') },
    },
  },
  {
    async fetch(request: Request) {
      // this.env.DB_SERVICE is typed as ServiceStub<DbServiceRPC>
      const user = await this.env.DB_SERVICE.getUser('user-123');
      return Response.json(user);
    },
  },
);
```

> **Sibling rewrite:** When `db-service` is a sibling module in the same build, the kit automatically rewrites the `service` field in `wrangler.jsonc` to the full deployed name (`${prefix}db-service${suffix}`). You don't need to track the prefix in your source code.

**Binding to a named environment of another worker:**

```ts
services: { MY_WORKER: service<MyWorkerRPC>('my-worker', 'production') }
// wrangler.jsonc: { "binding": "MY_WORKER", "service": "my-worker", "environment": "production" }
```

### Promise pipelining

When an RPC method returns an instance of a class that extends `RpcTarget`, Cloudflare Workers RPC supports **promise pipelining**: the caller can chain further method calls on the returned stub immediately, without an intermediate `await`. The two calls are delivered in a single network round-trip.

> See the [Cloudflare Workers RPC documentation](https://developers.cloudflare.com/workers/runtime-apis/rpc/#readablestream-writeablestream-request-and-response) for the full spec.

**Target worker** — expose a method that returns an `RpcTarget` subclass:

```ts
// src/modules/user-service/index.ts
import { defineWorker, RpcTarget, type WorkerRPC } from '@immi-yoyaku/cf-worker-kit';

class UserQuery extends RpcTarget {
  constructor(private db: D1Database, private userId: string) { super(); }

  async profile(): Promise<{ id: string; name: string; email: string }> {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').bind(this.userId).first();
  }

  async posts(): Promise<{ id: string; title: string }[]> {
    return this.db.prepare('SELECT id, title FROM posts WHERE user_id = ?').bind(this.userId).all().then(r => r.results);
  }
}

const worker = defineWorker(
  { name: 'user-service', bindings: { d1_databases: [{ binding: 'DB', database_id: '...' }] } },
  {
    // Returns RpcTarget subclass — enables pipelining on the caller side
    user(id: string): UserQuery {
      return new UserQuery(this.env.DB, id);
    },
  },
);

export type UserServiceRPC = WorkerRPC<typeof worker>;
export default worker;
```

**Caller** — chain calls without an intermediate `await`:

```ts
// Two separate round-trips (without pipelining):
const query = await this.env.USER_SERVICE.user(userId);
const profile = await query.profile();

// One round-trip (with pipelining — single await):
const profile = await this.env.USER_SERVICE.user(userId).profile();
```

`ServiceStub<RPC>` automatically maps any method whose return type extends `Rpc.Stubable` (which `RpcTarget` subclasses do) to `Rpc.Result<T>`, so TypeScript understands the chaining and preserves full return-type inference on the final awaited call.

---

## Config Reference

Create `cf-worker-kit.config.ts` at the project root (or pass `--config <path>` to any CLI command):

```ts
import { defineConfig } from '@immi-yoyaku/cf-worker-kit/build';

export default defineConfig({
  prefix: 'my-app-',
  modules: ['src/modules/*/index.ts'],
  outDir: '.build',
  baseConfig: {
    compatibility_date: '2026-04-08',
    compatibility_flags: ['nodejs_compat'],
  },
  dev: {
    persistTo: '.wrangler/state',
    ports: { api: 8787, web: 8788 },
  },
  envs: [
    { name: 'production', envFile: '.env.production', suffix: '' },
    { name: 'staging',    envFile: '.env.staging',    suffix: '-staging' },
  ],
});
```

### KitConfig fields

| Field | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | *(required)* | Prepended to every worker name: `${prefix}${name}`. E.g. `"my-app-"` → `my-app-api`. |
| `modules` | `string[]` | `['src/modules/**/index.ts', '!**/_*/**', '!**/__tests__/**']` | Glob patterns for worker entry files (passed to [globby](https://github.com/sindresorhus/globby)). |
| `outDir` | `string` | `".build"` | Directory where `wrangler.jsonc` files are generated. Resolved relative to the config file. |
| `baseConfig` | `BaseConfig` | *(see below)* | Wrangler config fields merged into every generated `wrangler.jsonc`. |
| `dev.persistTo` | `string` | *(none)* | Forwarded to `wrangler dev --persist-to`. Override per-run with `--persist-to`. |
| `dev.ports` | `Record<string, number>` | *(auto)* | Fixed port assignments keyed by module short name. Unassigned modules get a free port. |
| `envs` | `EnvConfig[]` | `[]` | Named environments for staging/production deploys. |

### Shared wrangler config (`baseConfig`)

`baseConfig` accepts any field from `wrangler.jsonc` (typed as `Omit<Unstable_RawEnvironment, 'name' | 'main'>`). It is merged into every generated config. Module-specific bindings and triggers always win on conflict.

The built-in defaults are:

```ts
{
  compatibility_date: '2026-04-08',
  compatibility_flags: ['nodejs_compat'],
  observability: { logs: { enabled: true, invocation_logs: true } },
}
```

Override any of these, or add extra fields, via `baseConfig` in your config file:

```ts
baseConfig: {
  compatibility_date: '2026-01-01',
  limits: { cpu_ms: 50 },
  upload_source_maps: true,
}
```

> See the [wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/) for the full list of supported fields.

---

## Multi-Environment

Use `envs` to maintain isolated staging and production deployments from the same codebase.

### Runtime variable overrides (`vars`)

Declare runtime variables in `bindings.vars` with a default (or empty) value, then override them per environment in an `envFile`. Any key in the `envFile` that is **not** prefixed with `CF_CONFIG_` and already exists in `bindings.vars` is overwritten in the generated `wrangler.jsonc`. Extra keys that are not declared in `bindings.vars` are silently ignored.

These values are available at **runtime** via `this.env.<KEY>` (typed as `string`).

**`.env.dev`:**

```env
TEST=test
```

**Worker module:**

```ts
import { defineWorker, service } from '@immi-yoyaku/cf-worker-kit';

export default defineWorker(
  {
    name: 'crawler-fetcher',
    bindings: {
      // Declare vars with a default (or empty) value.
      // The actual value is injected at build time from the envFile.
      vars: { TEST: '' },
    },
  },
  {
    async fetch() {
      return new Response(this.env.TEST); // "test" when built with --env dev
    },
  },
);
```

**Config file:**

```ts
export default defineConfig({
  prefix: 'my-app-',
  envs: [
    { name: 'dev', envFile: '.env.dev', suffix: '-dev' },
  ],
});
```

**Build with the env active:**

```sh
cf-worker-kit build --env dev   # (or: dev --env dev / deploy --build --env dev)
```

The generated `wrangler.jsonc` will contain `"vars": { "TEST": "test" }`.

> **Strict overlay:** Only keys already present in `bindings.vars` are overridden. Extra keys in the `envFile` that have no matching declaration are ignored, so the envFile can freely contain secrets or CI variables that are unrelated to this worker.

### Infrastructure IDs (`CF_CONFIG_*`)

Infrastructure binding IDs (D1 `database_id`, KV `id`, etc.) differ per environment. Store them in a dotenv-style file and prefix them with `CF_CONFIG_` — the kit injects these into `process.env` before your worker modules are imported, making them available inside `defineWorker`.

**`.env.production`:**

```env
CF_CONFIG_DB_ID=prod-db-uuid-here
CF_CONFIG_KV_ID=prod-kv-uuid-here
```

**`.env.staging`:**

```env
CF_CONFIG_DB_ID=staging-db-uuid-here
CF_CONFIG_KV_ID=staging-kv-uuid-here
```

**Worker module:**

```ts
import { defineWorker } from '@immi-yoyaku/cf-worker-kit';

export default defineWorker(
  {
    name: 'api',
    bindings: {
      d1_databases: [{ binding: 'DB',    database_id: process.env.CF_CONFIG_DB_ID! }],
      kv_namespaces: [{ binding: 'CACHE', id:          process.env.CF_CONFIG_KV_ID! }],
    },
  },
  { fetch: () => new Response('ok') },
);
```

**Config file:**

```ts
export default defineConfig({
  prefix: 'my-app-',
  envs: [
    { name: 'production', envFile: '.env.production', suffix: '' },
    { name: 'staging',    envFile: '.env.staging',    suffix: '-staging' },
  ],
});
```

**Deploy to staging:**

```sh
cf-worker-kit deploy --build --env staging
# Workers deployed as: my-app-api-staging, my-app-web-staging, …
```

**Deploy to production:**

```sh
cf-worker-kit deploy --build --env production
# Workers deployed as: my-app-api, my-app-web, …
```

### Build-time env context (`envs`)

The `envs` singleton is set by the build pipeline before your modules are imported. Use it to construct environment-specific resource names at build time:

```ts
import { defineWorker, envs } from '@immi-yoyaku/cf-worker-kit';

export default defineWorker(
  {
    name: 'db-service',
    bindings: {
      d1_databases: [{
        binding: 'DB',
        database_id: process.env.CF_CONFIG_DB_ID!,
        database_name: 'mydb' + envs.suffix,   // e.g. "mydb-staging" or "mydb"
      }],
    },
  },
  { fetch: () => new Response('ok') },
);
```

| Field | Value |
|---|---|
| `envs.suffix` | The active env's `suffix` (e.g. `"-staging"`). Empty string when no `--env` is active. |
| `envs.prefix` | The global `prefix` from `cf-worker-kit.config.ts` (e.g. `"my-app-"`). |

Both fields default to `''` so code compiles without null-checks during a plain `build` with no `--env`.

---

## CLI Reference

```sh
cf-worker-kit <build|dev|deploy> [options] [-- <wrangler args>]
```

Arguments after `--` are forwarded verbatim to every underlying `wrangler` invocation.

### build

Discovers module files, imports each one, and writes a `wrangler.jsonc` to `outDir/<name>/`.

```sh
cf-worker-kit build [--config <path>]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `cf-worker-kit.config.ts` | Path to the config file. |

### dev

Builds (unless `--no-build`) then starts all workers with `wrangler dev` in parallel. Each worker gets its own port. Output lines are prefixed with `[name:port]`.

```sh
cf-worker-kit dev [options] [-- <wrangler args>]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `cf-worker-kit.config.ts` | Path to the config file. |
| `--no-build` | off | Skip the build step; use existing output in `outDir`. Incompatible with `--env`. |
| `--app <name>` | *(all)* | Run only this module and all other local workers it transitively depends on via service bindings. Repeatable: `--app api --app web`. |
| `--env <name>` | *(none)* | Activate a named env (requires a fresh build; incompatible with `--no-build`). |
| `--persist-to <path>` | from config | Override `dev.persistTo` for local storage (KV, D1, R2, etc.). |
| `-- <wrangler args>` | | Forwarded to every `wrangler dev` child. Reserved flags (`--port`, `--config`, `--name`, `--persist-to`, `--inspector-port`) are rejected — configure these via the config file. |

### deploy

Deploys all workers in the build output using a dependency-aware parallel scheduler. A failed worker skips only its transitive dependents; unrelated workers continue.

```sh
cf-worker-kit deploy [options] [-- <wrangler args>]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `cf-worker-kit.config.ts` | Path to the config file. |
| `--build` | off | Run `build` before deploying. Mutually exclusive with `--path`. |
| `--path <dir>` | `outDir` (`.build`) | Deploy from a pre-built directory. Mutually exclusive with `--build`. |
| `--env <name>` | *(none)* | Activate a named env during build. **Requires `--build`** (env values are baked at build time). |
| `--concurrency <n>` | unbounded | Cap concurrent `wrangler deploy` invocations. The DAG width is the natural limit. |
| `--verbose` | off | Print full `wrangler deploy` output per worker. Auto-enabled in non-TTY / `CI=1`. |
| `-- <wrangler args>` | | Forwarded to every `wrangler deploy` call. |

**Cloudflare credentials** are read by `wrangler` from `CLOUDFLARE_API_TOKEN` (and optionally `CLOUDFLARE_ACCOUNT_ID`) in the environment:

```sh
export CLOUDFLARE_API_TOKEN="your_api_token_here"
export CLOUDFLARE_ACCOUNT_ID="your_account_id_here"
```

**Deploy output** shows an ASCII dependency tree with status icons (`✔` deployed, `✖` failed, `⏭` skipped), followed by a summary. Failed workers print their full `wrangler` output so errors are always visible.

---

## Build Output

After `cf-worker-kit build`, the output directory (default `.build`) contains one subdirectory per module:

```
.build/
├── api/
│   └── wrangler.jsonc    # generated config for the 'api' worker
├── web/
│   └── wrangler.jsonc
└── db-service/
    └── wrangler.jsonc
```

Each `wrangler.jsonc` is a complete, standalone config with:
- `name` set to `${prefix}${moduleName}${suffix}`
- `main` pointing to the source entry file (relative path)
- All bindings and triggers from `defineWorker`, plus all fields from `baseConfig`
- Service binding names rewritten to sibling workers' full deployed names

---

## Subpath Exports

| Subpath | Import from | What it provides |
|---|---|---|
| `@immi-yoyaku/cf-worker-kit` | Worker source files | `defineWorker`, `service`, `envs`, `WorkerRPC`, `InferEnv`, `WorkerBindings`, … |
| `@immi-yoyaku/cf-worker-kit/hono` | Worker source files (Hono) | `defineHonoWorker`, `InferHonoEnv` |
| `@immi-yoyaku/cf-worker-kit/build` | `cf-worker-kit.config.ts`, Node scripts | `defineConfig`, `build`, `dev`, `deploy`, `KitConfig`, `BaseConfig`, … |

> **Important:** Worker source files must only import from `.` and `./hono`. The `./build` subpath imports Node built-ins (`node:fs`, `node:module`, `globby`) that are not available in the Cloudflare Workers runtime and would break your bundle.

---

## Development

```sh
# Run the test suite
pnpm --filter @immi-yoyaku/cf-worker-kit test

# Type-check without emitting
pnpm --filter @immi-yoyaku/cf-worker-kit typecheck
```

Tests live under `__tests__/{runtime,build,cli,deploy,dev}/` mirroring the source tree. The runtime tests include TypeScript type-level assertions (`*.test-d.ts`) validated by vitest's `expectTypeOf`.

