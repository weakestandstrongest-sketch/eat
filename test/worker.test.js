import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import worker, { UsageCounter } from '../worker.js';

const BASE = 'https://eat.example.workers.dev';

// Durable Object のストレージを Map で代用する
const storage = new Map();
const env = {
  GOOGLE_MAPS_API_KEY: 'KEY',
  APP_PASSWORD: 'correct-horse',
  MONTHLY_LIMIT_NEARBY: '10',
  ASSETS: { fetch: async () => new Response('asset') },
  USAGE: {
    idFromName: (name) => name,
    get: () => {
      const counter = new UsageCounter(
        { storage: { get: async (k) => storage.get(k), put: async (k, v) => storage.set(k, structuredClone(v)) } },
        env,
      );
      return { fetch: (url, init) => counter.fetch(new Request(url, init)) };
    },
  },
};

const realFetch = globalThis.fetch;
let googleCalls = 0;
globalThis.fetch = async () => {
  googleCalls++;
  return new Response(JSON.stringify({ places: [] }), { status: 200 });
};
after(() => {
  globalThis.fetch = realFetch;
});

let cookie;

test('画面のファイルは ASSETS から返す', async () => {
  const res = await worker.fetch(new Request(`${BASE}/`), env);
  assert.equal(await res.text(), 'asset');
});

test('ログインしてから検索でき、回数が Durable Object に記録される', async () => {
  const login = await worker.fetch(
    new Request(`${BASE}/login`, { method: 'POST', body: new URLSearchParams({ password: 'correct-horse' }) }),
    env,
  );
  cookie = login.headers.get('Set-Cookie').split(';')[0];

  const res = await worker.fetch(new Request(`${BASE}/api/search?lat=35.17&lng=136.88`, { headers: { Cookie: cookie } }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.demo, false);
  assert.equal(body.usage.items.find((i) => i.kind === 'nearby').used, 7);
  assert.equal(storage.get('usage').counts.nearby, 7);
  assert.equal(googleCalls, 7);
});

test('上限 (MONTHLY_LIMIT_NEARBY=10) を超える検索は Google を呼ばずに 429', async () => {
  const res = await worker.fetch(new Request(`${BASE}/api/search?lat=35.68&lng=139.76`, { headers: { Cookie: cookie } }), env);
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /上限 \(10回\)/);
  assert.equal(googleCalls, 7);
});
