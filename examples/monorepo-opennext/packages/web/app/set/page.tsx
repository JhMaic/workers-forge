import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const runtime = 'edge';

// React Server Action — runs on the worker, calls the kv-store worker via RPC.
async function saveKv(formData: FormData): Promise<void> {
  'use server';
  const key = String(formData.get('key') ?? '').trim();
  const value = String(formData.get('value') ?? '');
  if (!key)
    return;
  const { env } = getCloudflareContext();
  await env.KV_STORE.set(key, value);
  redirect(`/read?key=${encodeURIComponent(key)}`);
}

export default function SetPage() {
  return (
    <main>
      <h1>Set a key</h1>
      <p>
        Writes via the
        {' '}
        <code>kv-store</code>
        {' '}
        worker's
        {' '}
        <code>set(key, value)</code>
        {' '}
        RPC.
      </p>
      <form action={saveKv} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '24rem' }}>
        <label>
          Key
          <input name="key" required style={{ display: 'block', width: '100%' }} placeholder="hello" />
        </label>
        <label>
          Value
          <textarea name="value" rows={3} style={{ display: 'block', width: '100%' }} placeholder="world" />
        </label>
        <button type="submit" style={{ alignSelf: 'flex-start' }}>Save</button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        <Link href="/">← back</Link>
      </p>
    </main>
  );
}
