# hono-basic

A `workers-forge` example demonstrating:

- **`defineHonoWorker`** — wraps a [Hono](https://hono.dev) app as a Cloudflare Worker
- **`InferHonoEnv`** — derives typed `c.env` bindings from the worker meta
- In-memory todos with `GET /todos` and `POST /todos`

---

## Prerequisites

- Node.js ≥ 20
- The root package must be built before running this example:
  ```sh
  # From the repo root:
  npm install
  npm run build
  ```

## Install

```sh
cd examples/hono-basic
npm install
```

## Run

```sh
npm run dev
```

Worker starts at **http://localhost:8787**.

## Try it

```sh
# Root route
curl http://localhost:8787/
# → {"message":"hono-basic example","env":"development"}

# List todos (empty on first run)
curl http://localhost:8787/todos
# → {"env":"development","todos":[]}

# Add a todo
curl -X POST http://localhost:8787/todos \
  -H 'Content-Type: application/json' \
  -d '{"text":"Learn workers-forge"}'
# → {"id":1,"text":"Learn workers-forge"}

# List again
curl http://localhost:8787/todos
# → {"env":"development","todos":[{"id":1,"text":"Learn workers-forge"}]}

# Empty text → 400
curl -X POST http://localhost:8787/todos \
  -H 'Content-Type: application/json' \
  -d '{"text":""}'
# → Bad Request
```

## Build only

```sh
npm run build
```

Generates `.build/web/wrangler.jsonc` without starting the dev server.

## Deploy

```sh
npm run deploy
```

Deploys as `hono-demo-web` (configured by the `prefix` in `workers-forge.config.ts`).

## Using outside this repo

Replace the local dependency with the published package:

```json
"workers-forge": "^1.0.1"
```

## What this shows

| Feature | Where to look |
|---------|---------------|
| `defineHonoWorker` | `src/modules/web/index.ts` |
| `InferHonoEnv` for typed bindings | `src/modules/web/index.ts` |
| `vars` binding in meta | `bindings: { vars: { APP_ENV: 'development' } }` |
| Worker name prefix | `prefix: 'hono-demo-'` in `workers-forge.config.ts` |
