import { defineWorker, type WorkerRPC } from 'workers-forge';

// A worker that *owns* the KV binding. Other workers (and the Next.js app)
// reach this KV only through the RPC methods below — they never get a direct
// KV binding of their own. This is the "service owns the data" pattern.
const worker = defineWorker(
  {
    name: 'kv-store',
    bindings: {
      vars: { LOG_LEVEL: '' },
      kv_namespaces: [
        // ID is filled at build time from process.env.CF_CONFIG_KV_ID, which
        // is loaded from `.env.<envName>` by workers-forge before this module
        // is imported.
        { binding: 'KV', id: process.env.CF_CONFIG_KV_ID! },
      ],
    },
  },
  {
    async get(key: string): Promise<string | null> {
      return await this.env.KV.get(key);
    },
    async set(key: string, value: string): Promise<void> {
      await this.env.KV.put(key, value);
    },
    async list(prefix?: string): Promise<{ keys: { name: string }[] }> {
      return await this.env.KV.list({ prefix });
    },
  },
);

export type KvStoreRpc = WorkerRPC<typeof worker>;
export default worker;
