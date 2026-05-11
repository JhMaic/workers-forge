import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>KV demo (via worker RPC)</h1>
      <p>
        Two pages, both backed by the
        {' '}
        <code>kv-store</code>
        {' '}
        worker in
        {' '}
        <code>packages/workers</code>
        :
      </p>
      <ul>
        <li>
          <Link href="/set">/set</Link>
          {' '}
          — write a key/value pair
        </li>
        <li>
          <Link href="/read">/read</Link>
          {' '}
          — read a value by key
        </li>
      </ul>
    </main>
  );
}
