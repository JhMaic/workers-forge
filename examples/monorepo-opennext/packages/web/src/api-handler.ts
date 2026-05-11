// Demonstrates the typed cross-package RPC call. In a real Next.js project
// this code lives in e.g. `app/api/kv/[key]/route.ts`.
import { getCloudflareContext } from '@opennextjs/cloudflare';

import './cloudflare-env';

export async function GET(_req: Request, ctx: { params: { key: string } }): Promise<Response> {
  const { env } = getCloudflareContext();

  // env.KV_STORE is typed as ServiceStub<KvStoreRpc>:
  //   - .get(key)  -> Promise<string | null>
  //   - .set(key, value)  -> Promise<void>
  //   - .list(prefix?)    -> Promise<{ keys: { name: string }[] }>
  const value = await env.KV_STORE.get(ctx.params.key);
  return Response.json({ value, app: env.APP_NAME });
}

export async function PUT(req: Request, ctx: { params: { key: string } }): Promise<Response> {
  const { env } = getCloudflareContext();
  const value = await req.text();
  await env.KV_STORE.set(ctx.params.key, value);
  return new Response(null, { status: 204 });
}
