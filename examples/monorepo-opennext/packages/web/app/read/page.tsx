import Link from 'next/link';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const runtime = 'edge';

interface SearchParams { key?: string }

export default async function ReadPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { key } = await searchParams;
  const { env } = getCloudflareContext();

  let value: string | null = null;
  let allKeys: { name: string }[] = [];
  if (key) {
    // Reads via the kv-store worker's `get(key)` RPC.
    value = await env.KV_STORE.get(key);
  }
  const list = await env.KV_STORE.list();
  allKeys = list.keys;

  return (
    <main>
      <h1>Read a key</h1>
      <form method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input name="key" defaultValue={key ?? ''} placeholder="hello" />
        <button type="submit">Read</button>
      </form>

      {key
        ? (
            <p style={{ marginTop: '1rem' }}>
              <strong>
                {key}
                :
              </strong>
              {' '}
              {value === null
                ? <em>(not set)</em>
                : <code>{value}</code>}
            </p>
          )
        : (
            <p style={{ marginTop: '1rem', color: '#666' }}>
              <em>Pick a key above or one of the keys below.</em>
            </p>
          )}

      <h2>All keys</h2>
      {allKeys.length === 0
        ? (
            <p>
              <em>
                No keys yet. Try
                {' '}
                <Link href="/set">/set</Link>
                .
              </em>
            </p>
          )
        : (
            <ul>
              {allKeys.map(k => (
                <li key={k.name}>
                  <Link href={`/read?key=${encodeURIComponent(k.name)}`}>{k.name}</Link>
                </li>
              ))}
            </ul>
          )}

      <p style={{ marginTop: '1rem' }}>
        <Link href="/">← back</Link>
      </p>
    </main>
  );
}
