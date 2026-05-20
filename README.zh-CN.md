# workers-forge

[![npm version](https://img.shields.io/npm/v/workers-forge.svg)](https://www.npmjs.com/package/workers-forge)
[![CI](https://github.com/JhMaic/workers-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/JhMaic/workers-forge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

[English](./README.md) | 中文

面向 Cloudflare Workers monorepo 的约定驱动构建、开发与部署工具。

在 TypeScript 中一次性声明 Worker 及其绑定 —— 工具自动为每个模块生成 `wrangler.jsonc`，提供完全类型化的 `this.env.*` 访问，无需任何手动配置，并统一编排所有 Worker 的 `wrangler dev` / `wrangler deploy`。

---

## 目录

- [概览](#概览)
- [安装](#安装)
- [快速开始](#快速开始)
- [定义 Worker](#定义-worker)
  - [绑定参考](#绑定参考)
  - [Worker 触发器](#worker-触发器)
  - [类型化环境（`InferEnv`）](#类型化环境inferenv)
  - [原始 wrangler 配置覆盖（`_raw`）](#原始-wrangler-配置覆盖_raw)
- [Hono 适配器](#hono-适配器)
- [Service Bindings 与 RPC](#service-bindings-与-rpc)
  - [Promise 管道调用](#promise-管道调用)
- [Durable Objects](#durable-objects)
- [配置参考](#配置参考)
  - [KitConfig 字段](#kitconfig-字段)
  - [共享 wrangler 配置（`baseConfig`）](#共享-wrangler-配置baseconfig)
- [多环境](#多环境)
  - [运行时变量覆盖（`vars`）](#运行时变量覆盖vars)
  - [基础设施 ID（`CF_CONFIG_*`）](#基础设施-idcf_config_)
  - [构建时环境上下文（`envs`）](#构建时环境上下文envs)
- [CLI 参考](#cli-参考)
  - [build](#build)
  - [dev](#dev)
  - [deploy](#deploy)
  - [gen](#gen)
- [构建输出](#构建输出)
- [子路径导出](#子路径导出)
- [示例](#示例)
- [开发](#开发)

---

## 概览

在 Cloudflare Workers monorepo 中，每个 Worker 通常都需要手写独立的 `wrangler.jsonc` 和与之同步的 TypeScript 环境类型——这项工作永无止境。新增一个 KV 命名空间，就要更新两个文件；重命名一个 Service Binding，就要搜遍所有引用。`workers-forge` 消除了这种重复：你只需在 TypeScript 中声明一次 Worker，工具会自动生成配置文件并推断所有类型。

**你能得到什么：**

- **零重复配置** —— `defineWorker(meta, methods)` 是唯一的事实来源。`workers-forge build` 为每个模块生成即用的 `wrangler.jsonc`；你永远不需要手动编写或编辑这些文件。
- **免费获得完全类型化的 `this.env`** —— 绑定声明在编译时被推断为精确的 `this.env` 类型。新增一个 D1 绑定，`this.env.DB` 立即成为 `D1Database` —— 无需单独的类型文件，无需类型断言。
- **类型化的跨 Worker RPC** —— `service<MyWorkerRPC>('worker-name')` 将目标 Worker 的方法签名附加到绑定上，在每次跨 Worker 调用时提供完整的 IntelliSense 和类型检查。
- **自动改写同级引用** —— 指向同一项目中其他 Worker 的 Service Binding 会被自动改写为完整的部署名称（`prefix + name + suffix`）。你在源码中使用短名称，工具负责其余的一切。
- **一键本地开发** —— `workers-forge dev` 并行启动所有 Worker，每个 Worker 拥有独立端口；输出带有 `[name:port]` 标签。使用 `--app api` 只启动某个 Worker 及其本地依赖。
- **依赖感知部署** —— `workers-forge deploy` 从 Service Binding 构建 DAG，按正确顺序部署。某个 Worker 失败只会跳过其传递依赖者；无关 Worker 继续正常部署。
- **无重复的多环境支持** —— 在配置文件中一次性声明 `envs`。每个环境的基础设施 ID（`CF_CONFIG_*`）和运行时变量覆盖在构建时注入；同一套源码可部署到 staging 和 production。

核心思路简洁明了：

```
defineWorker(meta, methods)
       │
  workers-forge build
       │
  .build/<name>/wrangler.jsonc   ← 交给 wrangler
  InferEnv<typeof meta>          ← 供 TypeScript 使用
```

---

## 安装

**前置条件**：Node.js ≥ 20

```bash
npm install --save-dev workers-forge
```

> `wrangler` 和 `tsx` 是必需的对等依赖。npm v7+ 会自动安装它们。如果你使用 **pnpm**，需要显式安装对等依赖：
> ```
> pnpm add -D workers-forge wrangler tsx
> ```

如果使用 [Hono 适配器](#hono-适配器)，还需安装：

```bash
npm install --save-dev hono
```

> **pnpm：** `pnpm add -D hono`

| 依赖       | 是否必须 | 版本  |
|------------|----------|-------|
| `wrangler` | ✅       | `^4`  |
| `tsx`      | ✅       | `^4`  |
| `hono`     | 可选     | `^4`  |

---

## 快速开始

**1. 在项目根目录创建配置文件：**

```ts
// workers-forge.config.ts
import { defineConfig } from 'workers-forge/build';

export default defineConfig({
  prefix: 'my-app-',
  modules: ['src/modules/*/index.ts'],
});
```

**2. 编写 Worker 模块**（`src/modules/api/index.ts`）：

```ts
import { defineWorker } from 'workers-forge';

const meta = {
  name: 'api',
  bindings: {
    vars: { GREETING: 'Hello' },
    kv_namespaces: [{ binding: 'CACHE', id: 'your-kv-id' }],
  },
} as const;

export default defineWorker(meta, {
  async fetch(request) {
    const cached = await this.env.CACHE.get('key'); // 类型为 KVNamespace
    return new Response(this.env.GREETING);          // 类型为 string
  },
});
```

**3. 在 `package.json` 中添加 CLI 脚本：**

```json
{
  "scripts": {
    "build":  "workers-forge build",
    "dev":    "workers-forge dev",
    "deploy": "workers-forge deploy --build"
  },
}
```

**4. 在项目根目录添加 `tsconfig.json`：**

```json
{
  "extends": "workers-forge/tsconfig",
  "include": ["src/**/*", "workers-forge.config.ts"]
}
```

**5. 运行：**

```sh
npm run build    # 为每个模块生成 .build/<name>/wrangler.jsonc
npm run dev      # 使用 wrangler dev 启动所有 Worker
npm run deploy   # 构建 + 部署到 Cloudflare
```

> **pnpm：** `pnpm build` / `pnpm dev` / `pnpm deploy`

---

## 定义 Worker

使用 `defineWorker(meta, methods)` 声明 Worker：

```ts
import { defineWorker } from 'workers-forge';

export default defineWorker(
  {
    name: 'my-worker',        // 短名称；构建时会添加前缀
    bindings: { … },          // 参见下方绑定参考
    triggers: { … },          // 参见下方 Worker 触发器
  },
  {
    // Worker 方法 —— 所有处理器和 RPC 方法都在这里定义。
    // `this` 的类型为 WorkerEntrypoint，且 this.env 完全类型化。
    async fetch(request: Request) {
      return new Response('ok');
    },
    async myRpcMethod(arg: string): Promise<string> {
      return `hello ${arg}`;
    },
  },
);
```

> **Worker 名称** 必须匹配 `[a-z0-9-]+`，最终部署名称（`prefix` + `name` + 可选 `suffix`）不得超过 63 个字符。

### 绑定参考

所有字段均为可选。每个字段直接对应生成的 `wrangler.jsonc` 中的一个顶层节。

| 字段 | TypeScript 类型 | 运行时类型 | wrangler.jsonc 键 |
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
| `send_email` | `SendEmailDecl[]` | (send 方法) | `send_email` |

**示例 —— 多绑定：**

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

### Worker 触发器

触发器定义 Worker 的*调用方式*，而非*绑定内容*。

```ts
const meta = {
  name: 'processor',
  triggers: {
    // Cron —— 按计划运行
    cron: '0 * * * *',
    // 或多个：cron: ['0 * * * *', '30 * * * *'],

    // 队列消费者 —— 由传入的队列消息触发
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

    // Tail 消费者 —— 接收另一个 Worker 的 tail 事件
    tail: {
      producers: [{ service: 'api' }],
    },
  },
} as const;
```

> **队列生产者 vs 消费者：** 使用 `bindings.queues.producers` 来*发送*消息；使用 `triggers.queue.consumers` 来*接收*消息。

### 类型化环境（`InferEnv`）

`this.env` 会根据你的 `bindings` 声明自动获得类型。你也可以导出环境类型供其他地方使用：

```ts
import type { InferEnv } from 'workers-forge';

const meta = { name: 'api', bindings: { vars: { TOKEN: '' } } } as const;

type Env = InferEnv<typeof meta>; // { TOKEN: string }
```

### 原始 wrangler 配置覆盖（`_raw`）

`_raw` 允许你以**最高优先级**为特定 Worker 注入任意 wrangler 配置字段。其内容会逐字写入生成的 `wrangler.jsonc` —— 不会进行任何前缀、后缀或同级服务名称替换。

**覆盖优先级（从低到高）：**

1. `workers-forge.config` 中的 `baseConfig` —— 所有 Worker 的全局默认值
2. `defineWorker` 的 `bindings` + `triggers` —— 单个 Worker，参与名称替换
3. `_raw` —— 单个 Worker，**不参与**名称替换，会覆盖以上所有层

`_raw` 的类型为 `Omit<Unstable_RawEnvironment, 'name' | 'main'>`，与 `BaseConfig` 相同。`name` 和 `main` 字段始终由工具管理，无法被覆盖。

```ts
export default defineWorker(
  {
    name: 'api',
    bindings: {
      vars: { TIMEOUT: '5000' },
    },
    _raw: {
      // 仅为此 Worker 提高 CPU 限制
      limits: { cpu_ms: 500 },
      // 完整覆盖 vars（绕过 bindings.vars 合并逻辑）
      vars: { TIMEOUT: '30000', EXTRA_FLAG: 'true' },
    },
  },
  { fetch: () => new Response('ok') },
);
```

> **不进行名称替换：** `_raw` 中的服务名称、绑定 ID 及其他字段均按原样写入。如果你在 `_raw.services` 中引用了同级 Worker，需要自行写入完整的部署名称（含前缀和后缀）。

---

## Hono 适配器

对于基于 Hono 的 Worker，请使用 `./hono` 子路径中的 `defineHonoWorker`：

```ts
// src/modules/web/index.ts
import { Hono } from 'hono';
import { defineHonoWorker, type InferHonoEnv } from 'workers-forge/hono';

const meta = {
  name: 'web',
  bindings: {
    vars: { GREETING: 'Hello' },
    kv_namespaces: [{ binding: 'CACHE', id: 'abc123' }],
  },
} as const;

// 将 meta 作为 Hono 泛型传入，使 c.env 完全类型化
const app = new Hono<InferHonoEnv<typeof meta>>();

app.get('/hello', async (c) => {
  const cached = await c.env.CACHE.get('key'); // KVNamespace
  return c.text(c.env.GREETING);               // string
});

export default defineHonoWorker(meta, app);
```

---

## Service Bindings 与 RPC

Worker 之间通过 [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) 进行通信。工具为 Service Stub 提供类型化的 RPC 接口，调用方可以获得自动补全和类型检查。

**1. 从目标 Worker 导出 RPC 类型：**

```ts
// src/modules/db-service/index.ts
import { defineWorker, type WorkerRPC } from 'workers-forge';

const worker = defineWorker(
  { name: 'db-service', bindings: {} },
  {
    async getUser(id: string): Promise<{ id: string; name: string } | null> {
      return null; // 实际实现
    },
  },
);

export type DbServiceRPC = WorkerRPC<typeof worker>;
// ^ { getUser(id: string): Promise<{ id: string; name: string } | null> }

export default worker;
```

**2. 使用 `service<RPC>()` 绑定目标 Worker：**

```ts
// src/modules/api/index.ts
import { defineWorker, service } from 'workers-forge';
import type { DbServiceRPC } from '../db-service';

export default defineWorker(
  {
    name: 'api',
    bindings: {
      // Record 的键（'DB_SERVICE'）成为 wrangler.jsonc 和 this.env 中的绑定名称。
      // 传入 RPC 类型作为泛型以获得 IntelliSense。
      services: { DB_SERVICE: service<DbServiceRPC>('db-service') },
    },
  },
  {
    async fetch(request: Request) {
      // this.env.DB_SERVICE 的类型为 ServiceStub<DbServiceRPC>
      const user = await this.env.DB_SERVICE.getUser('user-123');
      return Response.json(user);
    },
  },
);
```

> **同级改写：** 当 `db-service` 是同一构建中的同级模块时，工具会自动将 `wrangler.jsonc` 中的 `service` 字段改写为完整部署名称（`${prefix}db-service${suffix}`）。你无需在源码中追踪前缀。

**绑定到另一个 Worker 的具名环境：**

```ts
services: { MY_WORKER: service<MyWorkerRPC>('my-worker', 'production') }
// wrangler.jsonc: { "binding": "MY_WORKER", "service": "my-worker", "environment": "production" }
```

### Promise 管道调用

当 RPC 方法返回一个继承自 `RpcTarget` 的类实例时，Cloudflare Workers RPC 支持 **Promise 管道调用**：调用方无需中间 `await` 即可链式调用返回 Stub 上的后续方法。两次调用在单次网络往返中完成。

> 完整规范请参阅 [Cloudflare Workers RPC 文档](https://developers.cloudflare.com/workers/runtime-apis/rpc/#readablestream-writeablestream-request-and-response)。

**目标 Worker** —— 暴露一个返回 `RpcTarget` 子类的方法：

```ts
// src/modules/user-service/index.ts
import { defineWorker, RpcTarget, type WorkerRPC } from 'workers-forge';

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
    // 返回 RpcTarget 子类 —— 使调用方能够进行管道调用
    user(id: string): UserQuery {
      return new UserQuery(this.env.DB, id);
    },
  },
);

export type UserServiceRPC = WorkerRPC<typeof worker>;
export default worker;
```

**调用方** —— 无需中间 `await` 进行链式调用：

```ts
// 两次独立的网络往返（无管道调用）：
const query = await this.env.USER_SERVICE.user(userId);
const profile = await query.profile();

// 一次网络往返（管道调用 —— 单次 await）：
const profile = await this.env.USER_SERVICE.user(userId).profile();
```

`ServiceStub<RPC>` 会自动将返回类型继承自 `Rpc.Stubable`（`RpcTarget` 子类满足此条件）的方法映射为 `Rpc.Result<T>`，因此 TypeScript 能够理解这种链式调用，并对最终 await 的调用保留完整的返回类型推断。

---

## Durable Objects

`defineDurableObject(meta, methods)` 是 DO 版本的 `defineWorker` —— 一个模块文件即一个完整 Worker 脚本，承载 DO 类。构建期自动生成 `wrangler.jsonc`（含 `migrations`）以及一个 entry barrel，把类以派生 PascalCase 命名导出，让 workerd 能在 bundle 里解析。消费侧通过 `durableObject<RPC>('name')` 引用，与 `service<RPC>('name')` 完全一致：类型只走 `import type`，零运行时耦合。

**1. 定义 DO（单文件）：**

```ts
// src/modules/counter/index.ts
import { defineDurableObject, type DurableObjectRPC } from 'workers-forge';

const counter = defineDurableObject(
  {
    name: 'counter',          // worker 脚本名；class_name 从 name 派生（kebab/snake → PascalCase）
    // storage: 'sqlite',     // 默认；使用 'kv' 切到旧版 KV 后端
    // bindings: { ... },     // 与 WorkerBindings 同形态 —— DO 方法内 this.env 拥有完整类型
  },
  {
    async increment(by = 1) {
      const v = (await this.ctx.storage.get<number>('n')) ?? 0;
      await this.ctx.storage.put('n', v + by);
      return v + by;
    },
    async value() {
      return (await this.ctx.storage.get<number>('n')) ?? 0;
    },
  },
);

export type CounterRPC = DurableObjectRPC<typeof counter>;
export default counter;
```

**2. 在其它 worker 中消费：**

```ts
// src/modules/gateway/index.ts
import { defineWorker, durableObject } from 'workers-forge';
import type { CounterRPC } from '../counter';

export default defineWorker(
  {
    name: 'gateway',
    bindings: {
      durable_objects: {
        // Record 的 key 即 this.env 上的绑定名
        COUNTER: durableObject<CounterRPC>('counter'),
      },
    },
  },
  {
    async fetch() {
      const stub = this.env.COUNTER.get(this.env.COUNTER.idFromName('global'));
      const n = await stub.increment();   // 完整 RPC 类型
      return Response.json({ n });
    },
  },
);
```

**3. 生成的配置（由 kit 托管）：**

```jsonc
// .build/counter/wrangler.jsonc —— 自动生成
{
  "name": "pfx-counter",
  "main": "entry.ts",
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Counter"] }]
}
```

```jsonc
// .build/gateway/wrangler.jsonc —— 自动生成
{
  "name": "pfx-gateway",
  "durable_objects": {
    "bindings": [
      { "name": "COUNTER", "class_name": "Counter", "script_name": "pfx-counter" }
    ]
  }
}
```

> **Sibling 重写：** `script_name` 与 `services` 走完全相同的 `prefix`/`suffix` 重写代码路径。同项目模块自动重写为部署后的全名，外部 DO 名（不在 siblings 集合）原样透传。

**进阶 migrations** —— 默认只生成首次 `new_classes` / `new_sqlite_classes`。需要 rename / delete 时通过 `_raw.migrations` 覆盖：

```ts
defineDurableObject(
  {
    name: 'counter',
    _raw: {
      migrations: [
        { tag: 'v1', new_sqlite_classes: ['Counter'] },
        { tag: 'v2', renamed_classes: [{ from: 'Counter', to: 'CounterV2' }] },
      ],
    },
  },
  { /* methods */ },
);
```

`DurableObjectRPC<typeof counter>` 抽取 DO 的公开 RPC 表面 —— 排除平台内置 handler（`alarm`、`fetch`、`connect`、`webSocketMessage`/`Close`/`Error`），保留用户方法，与 `WorkerRPC<typeof worker>` 对齐。

---

## 配置参考

在项目根目录创建 `workers-forge.config.ts`（或通过 `--config <path>` 传给任何 CLI 命令）：

```ts
import { defineConfig } from 'workers-forge/build';

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
    // groups: { 'queue-stack': ['producer', 'consumer'] },  // 可选：合并为单个 wrangler dev
  },
  envs: [
    { name: 'production', envFile: '.env.production', suffix: '' },
    { name: 'staging',    envFile: '.env.staging',    suffix: '-staging' },
  ],
});
```

### KitConfig 字段

| 字段 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `prefix` | `string` | *（必填）* | 拼接在每个 Worker 名称前：`${prefix}${name}`。例如 `"my-app-"` → `my-app-api`。 |
| `modules` | `string[]` | `['src/modules/**/index.ts', '!**/_*/**', '!**/__tests__/**']` | Worker 入口文件的 Glob 模式（传给 [globby](https://github.com/sindresorhus/globby)）。 |
| `outDir` | `string` | `".build"` | 生成 `wrangler.jsonc` 文件的目录，相对于配置文件解析。 |
| `baseConfig` | `BaseConfig` | *（见下文）* | 合并到每个生成的 `wrangler.jsonc` 中的 Wrangler 配置字段。 |
| `dev.persistTo` | `string` | *（无）* | 转发给 `wrangler dev --persist-to`。可通过 `--persist-to` 在运行时覆盖。 |
| `dev.ports` | `Record<string, number>` | *（自动）* | 固定主端口分配。键可以是模块短名称（未分组的 Worker），也可以是 `dev.groups` 的组名（用于合并会话）。未分配的单元获得空闲端口。 |
| `dev.groups` | `Record<string, string[]>` | *（无）* | 将多个 Worker 共置在同一个 `wrangler dev` 进程中。每个条目把组名映射到一组有序的 Worker 短名称；列表中第一个是主 `-c`。适用于必须共享同一开发会话的 Queue 生产者/消费者对。详见[合并 dev 会话](#合并-dev-会话)。 |
| `envs` | `EnvConfig[]` | `[]` | staging/production 部署的具名环境。 |

### 共享 wrangler 配置（`baseConfig`）

`baseConfig` 接受 `wrangler.jsonc` 中的任何字段（类型为 `Omit<Unstable_RawEnvironment, 'name' | 'main'>`）。它会被合并到每个生成的配置中，作为优先级最低的层。模块特定的 `bindings`/`triggers` 在冲突时优先于 `baseConfig`，而单个 Worker 的 `_raw` 字段优先于一切。

内置默认值为：

```ts
{
  compatibility_date: '2026-04-08',
  compatibility_flags: ['nodejs_compat'],
  observability: { logs: { enabled: true, invocation_logs: true } },
}
```

可通过配置文件中的 `baseConfig` 覆盖任何这些值或添加额外字段：

```ts
baseConfig: {
  compatibility_date: '2026-01-01',
  limits: { cpu_ms: 50 },
  upload_source_maps: true,
}
```

> 完整支持字段列表请参阅 [wrangler 配置参考](https://developers.cloudflare.com/workers/wrangler/configuration/)。

---

## 多环境

使用 `envs` 从同一套代码库维护独立的 staging 和 production 部署。

### 运行时变量覆盖（`vars`）

在 `bindings.vars` 中声明运行时变量（使用默认值或空值），然后在 `envFile` 中按环境覆盖它们。`envFile` 中**未**以 `CF_CONFIG_` 为前缀且已在 `bindings.vars` 中声明的键，会在生成的 `wrangler.jsonc` 中被覆盖。未在 `bindings.vars` 中声明的额外键会被静默忽略。

这些值在**运行时**通过 `this.env.<KEY>`（类型为 `string`）获取。

**`.env.dev`：**

```env
TEST=test
```

**Worker 模块：**

```ts
import { defineWorker, service } from 'workers-forge';

export default defineWorker(
  {
    name: 'crawler-fetcher',
    bindings: {
      // 声明带有默认值（或空值）的 vars。
      // 实际值在构建时从 envFile 注入。
      vars: { TEST: '' },
    },
  },
  {
    async fetch() {
      return new Response(this.env.TEST); // 使用 --env dev 构建时为 "test"
    },
  },
);
```

**配置文件：**

```ts
export default defineConfig({
  prefix: 'my-app-',
  envs: [
    { name: 'dev', envFile: '.env.dev', suffix: '-dev' },
  ],
});
```

**激活环境进行构建：**

```sh
workers-forge build --env dev   # 同样适用于：dev --env dev / deploy --build --env dev
```

生成的 `wrangler.jsonc` 将包含 `"vars": { "TEST": "test" }`。

> **严格覆盖：** 只有已在 `bindings.vars` 中存在的键才会被覆盖。`envFile` 中没有匹配声明的额外键会被忽略，因此 envFile 可以自由包含与该 Worker 无关的密钥或 CI 变量。

### 基础设施 ID（`CF_CONFIG_*`）

基础设施绑定 ID（D1 的 `database_id`、KV 的 `id` 等）因环境而异。将它们存储在 dotenv 格式的文件中，并以 `CF_CONFIG_` 为前缀 —— 工具会在导入 Worker 模块前将这些值注入 `process.env`，使其在 `defineWorker` 内部可用。

**`.env.production`：**

```env
CF_CONFIG_DB_ID=prod-db-uuid-here
CF_CONFIG_KV_ID=prod-kv-uuid-here
```

**`.env.staging`：**

```env
CF_CONFIG_DB_ID=staging-db-uuid-here
CF_CONFIG_KV_ID=staging-kv-uuid-here
```

**Worker 模块：**

```ts
import { defineWorker } from 'workers-forge';

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

**配置文件：**

```ts
export default defineConfig({
  prefix: 'my-app-',
  envs: [
    { name: 'production', envFile: '.env.production', suffix: '' },
    { name: 'staging',    envFile: '.env.staging',    suffix: '-staging' },
  ],
});
```

**部署到 staging：**

```sh
workers-forge deploy --build --env staging
# 部署的 Worker 名称为：my-app-api-staging, my-app-web-staging, …
```

**部署到 production：**

```sh
workers-forge deploy --build --env production
# 部署的 Worker 名称为：my-app-api, my-app-web, …
```

### 构建时环境上下文（`envs`）

`envs` 单例在构建流水线导入模块前被设置。使用它在构建时构造特定于环境的资源名称：

```ts
import { defineWorker, envs } from 'workers-forge';

export default defineWorker(
  {
    name: 'db-service',
    bindings: {
      d1_databases: [{
        binding: 'DB',
        database_id: process.env.CF_CONFIG_DB_ID!,
        database_name: 'mydb' + envs.suffix,   // 例如 "mydb-staging" 或 "mydb"
      }],
    },
  },
  { fetch: () => new Response('ok') },
);
```

| 字段 | 值 |
|---|---|
| `envs.suffix` | 当前激活环境的 `suffix`（例如 `"-staging"`）。未激活 `--env` 时为空字符串。 |
| `envs.prefix` | 来自 `workers-forge.config.ts` 的全局 `prefix`（例如 `"my-app-"`）。 |

两个字段默认都为 `''`，因此代码在不带 `--env` 的普通 `build` 时也能编译，无需空值检查。

---

## CLI 参考

```sh
workers-forge <build|dev|deploy> [options] [-- <wrangler args>]
```

`--` 之后的参数会原样转发给每个底层的 `wrangler` 调用。

### build

发现模块文件，逐一导入，并将 `wrangler.jsonc` 写入 `outDir/<name>/`。

```sh
workers-forge build [options]
```

| 标志 | 默认值 | 描述 |
|---|---|---|
| `--config <path>` | `workers-forge.config.ts` | 配置文件路径。 |
| `--env <name>` | *（无）* | 激活具名环境（必须匹配 `envs[].name` 中的条目）。envFile 中的 vars 会覆盖声明的 `vars`；Worker 名称会附加环境后缀。 |
| `--app <name>` | *（全部）* | 只构建该模块。可重复：`--app api --app web`。其他 Worker 在 `outDir` 中的已有输出会被保留。 |

### dev

先构建（除非使用 `--no-build`），然后并行以 `wrangler dev` 启动所有 Worker。每个 Worker 拥有独立端口，输出行带有 `[name:port]` 前缀。

```sh
workers-forge dev [options] [-- <wrangler args>]
```

| 标志 | 默认值 | 描述 |
|---|---|---|
| `--config <path>` | `workers-forge.config.ts` | 配置文件路径。 |
| `--no-build` | 关闭 | 跳过构建步骤，使用 `outDir` 中的现有输出。与 `--env` 不兼容。 |
| `--app <name>` | *（全部）* | 只运行该模块以及它通过 Service Binding 传递依赖的所有本地 Worker。可重复：`--app api --app web`。若目标 Worker 属于某个 `dev.groups` 组，整个组会被一同启动。 |
| `--env <name>` | *（无）* | 激活具名环境（需要全新构建；与 `--no-build` 不兼容）。 |
| `--persist-to <path>` | 来自配置 | 覆盖本地存储（KV、D1、R2 等）的 `dev.persistTo`。 |
| `-- <wrangler args>` | | 转发给每个 `wrangler dev` 子进程。保留标志（`--port`、`--config`、`--name`、`--persist-to`、`--inspector-port`）会被拒绝 —— 请通过配置文件设置这些选项。 |

#### 合并 dev 会话

默认情况下 `workers-forge dev` 为每个 Worker 启动一个独立的 `wrangler dev` 进程。某些工作负载 —— 典型如 Cloudflare Queue 的生产者/消费者对 —— 必须共享同一个 `wrangler dev` 会话，绑定才能在进程内解析。在 `dev.groups` 中声明分组即可：

```ts
// workers-forge.config.ts
export default defineConfig({
  prefix: 'qmdemo-',
  modules: ['src/modules/*/index.ts'],
  dev: {
    groups: {
      'queue-stack': ['producer', 'consumer'],
    },
    ports: {
      'queue-stack': 8787,   // 合并子进程的主端口
    },
    persistTo: '.wrangler/state',
  },
});
```

工具会为该组启动单个合并子进程：

```sh
wrangler dev \
  -c .build/producer/wrangler.jsonc \
  -c .build/consumer/wrangler.jsonc \
  --port 8787 \
  --persist-to .wrangler/state
```

规则：

- 组名不能与任何 Worker 短名称冲突，且必须匹配 `[a-z0-9-]+`。
- 列表中第一个 Worker 为主（第一个 `-c`，`--port` 应用于该 Worker）。
- 每个 Worker 最多只能属于一个组；未列入任何组的 Worker 仍按独立进程启动。
- `dev.ports` 的键可以是组名或未分组的 Worker 短名称。若把端口指向组内成员，会被拒绝 —— 请改为把端口设到组上。
- 完整可运行示例见 [`examples/queues-merged-dev/`](examples/queues-merged-dev/)。

### deploy

使用依赖感知的并行调度器部署构建输出中的所有 Worker。某个 Worker 失败只会跳过其传递依赖者；无关 Worker 继续正常部署。

```sh
workers-forge deploy [options] [-- <wrangler args>]
```

| 标志 | 默认值 | 描述 |
|---|---|---|
| `--config <path>` | `workers-forge.config.ts` | 配置文件路径。 |
| `--build` | 关闭 | 部署前先运行 `build`。与 `--path` 互斥。 |
| `--path <dir>` | `outDir`（`.build`）| 从预构建目录部署。与 `--build` 互斥。 |
| `--env <name>` | *（无）* | 构建期间激活具名环境。**需要 `--build`**（env 值在构建时写入）。 |
| `--concurrency <n>` | 无限制 | 限制并发 `wrangler deploy` 调用数。DAG 宽度是自然上限。 |
| `--verbose` | 关闭 | 每个 Worker 打印完整的 `wrangler deploy` 输出。在非 TTY / `CI=1` 环境下自动启用。 |
| `-- <wrangler args>` | | 转发给每个 `wrangler deploy` 调用。 |

**Cloudflare 凭证**由 `wrangler` 从环境中的 `CLOUDFLARE_API_TOKEN`（以及可选的 `CLOUDFLARE_ACCOUNT_ID`）读取：

```sh
export CLOUDFLARE_API_TOKEN="your_api_token_here"
export CLOUDFLARE_ACCOUNT_ID="your_account_id_here"
```

**部署输出**展示带有状态图标的 ASCII 依赖树（`✔` 已部署、`✖` 失败、`⏭` 已跳过），末尾附有汇总信息。失败的 Worker 会打印其完整的 `wrangler` 输出，确保错误始终可见。

### gen

从一份用户编写的 meta 文件生成单个 `wrangler.jsonc`。适用于：你的项目（基于 `@opennextjs/cloudflare` 的 Next.js、Remix、独立 Worker 等）需要一份分环境、带类型推导的 `wrangler.jsonc`，但本身不符合 `build` 的多模块模型 —— 典型场景是 monorepo 里跟 Workers 包并列的另一个包，复用同一份 `envs` 和 `prefix`。

```sh
workers-forge gen <metaFile> [options]
```

| 选项 | 默认值 | 说明 |
|---|---|---|
| `<metaFile>` | *(必填)* | 命名导出 `meta` 的 TS/JS 文件（一个 `WorkerMeta`，通常用 `defineWorkerMeta` 编写）。 |
| `--out <path>` | `./wrangler.jsonc` | 生成文件的输出路径。 |
| `--env <name>` | *(无)* | 激活配置中 `envs[]` 的某个环境（覆写 vars、追加 suffix、在导入 meta 之前把 `CF_CONFIG_*` 注入 `process.env`）。 |
| `--config <path>` | `workers-forge.config.ts` | 配置文件路径。`gen` 只读取 `envs[]`、`baseConfig`、`prefix`、`modules` 四项，`dev` / `outDir` 等会被忽略。 |

当共享配置里有 `modules` glob 时，`gen` 还会从那些模块里发现 sibling worker 名字，自动把 `services[].service` 改写成完整部署名（`${prefix}${name}${suffix}`）—— 与 `build` 行为一致。所以在 monorepo 里你可以直接写 `service<MyRpc>('my-worker')`，每个环境自动解析正确。

完整接线参考 [`examples/monorepo-opennext`](./examples/monorepo-opennext)：一个 pnpm monorepo 把 Workers 包和 Next.js（OpenNext）包接到同一份共享配置上。

---

## 构建输出

执行 `workers-forge build` 后，输出目录（默认 `.build`）包含每个模块的子目录：

```
.build/
├── api/
│   └── wrangler.jsonc    # 为 'api' Worker 生成的配置
├── web/
│   └── wrangler.jsonc
└── db-service/
    └── wrangler.jsonc
```

每个 `wrangler.jsonc` 都是完整的独立配置，包含：
- `name` 设置为 `${prefix}${moduleName}${suffix}`
- `main` 指向源码入口文件（相对路径）
- 来自 `defineWorker` 的所有绑定和触发器，加上 `baseConfig` 中的所有字段
- Service Binding 名称改写为同级 Worker 的完整部署名称

---

## 子路径导出

| 子路径 | 导入来源 | 提供内容 |
|---|---|---|
| `workers-forge` | Worker 源文件 / app meta 文件 | `defineWorker`、`defineWorkerMeta`、`service`、`envs`、`WorkerRPC`、`InferEnv`、`WorkerBindings`… |
| `workers-forge/hono` | Worker 源文件（Hono） | `defineHonoWorker`、`InferHonoEnv` |
| `workers-forge/build` | `workers-forge.config.ts`、Node 脚本 | `defineConfig`、`build`、`dev`、`deploy`、`gen`、`KitConfig`、`BaseConfig`… |

> **重要：** Worker 源文件只能从 `.` 和 `./hono` 导入。`./build` 子路径导入了 Node 内置模块（`node:fs`、`node:module`、`globby`），这些模块在 Cloudflare Workers 运行时中不可用，会导致 bundle 出错。

---

## 示例

可直接运行的示例位于 [`examples/`](./examples) 目录。

| 示例 | 描述 |
|---------|-------------|
| [`rpc-multi-env`](./examples/rpc-multi-env) | KV → data-worker --RPC--> api-worker，支持 `local`/`stage` 环境隔离 |
| [`rpc-multi-env-hono`](./examples/rpc-multi-env-hono) | 同上，但 `api-worker` 使用 Hono 适配器（`defineHonoWorker`）；Worker 以扁平文件方式定义在 `src/` 下 |
| [`monorepo-opennext`](./examples/monorepo-opennext) | pnpm monorepo：一个 Workers 包加一个 Next.js 16（`@opennextjs/cloudflare`）包共享同一份配置。Next.js 侧把 `workers-forge gen` 纯当作 `wrangler.jsonc` 生成器使用，并通过类型化 RPC 调用 sibling Worker。 |

每个示例都是独立的项目，包含自己的 `package.json` 和 `README.md`。

---

## 开发

```sh
# 安装依赖
npm install

# 构建（将 TypeScript 编译到 dist/）
npm run build

# 运行测试套件
npm test

# 类型检查（不生成输出）
npm run typecheck
```

测试位于 `__tests__/{runtime,build,cli,deploy,dev}/`，与源码树结构对应。运行时测试包含 TypeScript 类型级断言（`*.test-d.ts`），由 vitest 的 `expectTypeOf` 验证。
