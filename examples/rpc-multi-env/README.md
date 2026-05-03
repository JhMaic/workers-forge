# rpc-multi-env

A `workers-forge` example demonstrating:

- **D1 → workerA (data-worker) --RPC--> workerB (api-worker)**
- Two named environments (`local` / `stage`) with separate `.env` files
- `CF_CONFIG_*` infrastructure IDs swap the D1 database per env
- `APP_ENV` runtime variable shows which env is active at runtime

All `dev` commands run **fully locally** — no Cloudflare account needed.

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
cd examples/rpc-multi-env
npm install
```

## Run (local env)

**1. Start all workers** — `dev` auto-builds wrangler configs on first run:

```sh
npm run dev
```

Workers start at:
- `api-worker` → http://localhost:8787
- `data-worker` → http://localhost:8788

**2. Initialise the local D1 schema** (first time only, in a second terminal):

```sh
npx wrangler d1 execute todos-local --local \
  --config .build/data-worker/wrangler.jsonc \
  --persist-to .wrangler/state \
  --command "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)"
```

**3. Try it:**

```sh
# List todos (empty on first run)
curl http://localhost:8787/todos
# → {"env":"local","todos":[]}

# Add a todo
curl -X POST http://localhost:8787/todos \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello"}'
# → {"id":1,"text":"hello"}

# List again
curl http://localhost:8787/todos
# → {"env":"local","todos":[{"id":1,"text":"hello"}]}
```

## Run (stage env)

> **`.env.stage` note:** The `CF_CONFIG_D1_ID=<your-stage-d1-database-id>` placeholder is fine for
> `dev:stage` — wrangler dev always runs locally and ignores the actual ID.
> Only `deploy:stage` needs a real Cloudflare D1 database ID.

```sh
npm run dev:stage
```

In a second terminal, initialise the stage D1 schema (first time only):

```sh
npx wrangler d1 execute todos-stage --local \
  --config .build/data-worker/wrangler.jsonc \
  --persist-to .wrangler/state \
  --command "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)"
```

The same requests now return `"env":"stage"` and write to a **separate local SQLite file** —
no source code changes needed.

## Deploy to stage (requires Cloudflare account)

1. Create a D1 database and paste the `database_id` into `.env.stage`:
   ```sh
   npx wrangler d1 create todos-stage
   # Copy the database_id printed above into .env.stage → CF_CONFIG_D1_ID
   ```
2. Initialise the remote schema:
   ```sh
   npx wrangler d1 execute todos-stage \
     --command "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)"
   ```
3. Deploy:
   ```sh
   npm run deploy:stage
   ```

Workers deploy as `rpc-demo-api-worker-stage` and `rpc-demo-data-worker-stage`.

## Using outside this repo

Replace the local dependency with the published package:

```json
"workers-forge": "^1.0.1"
```

## What this shows

| Feature | Where to look |
|---------|---------------|
| `CF_CONFIG_*` infrastructure IDs | `.env.local` / `.env.stage` + `data-worker/index.ts` |
| `vars` runtime overrides | `.env.local` → `APP_ENV=local` surfacing in API response |
| `WorkerRPC` typed service binding | `api-worker/index.ts` imports `DataWorkerRPC` |
| Sibling service rewrite | `service('data-worker')` → `rpc-demo-data-worker-local` in wrangler.jsonc |
| Multi-env dev with `--env` | `npm run dev` vs `npm run dev:stage` |
