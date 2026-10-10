import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUsage, currentMonth } from '../lib/usage.js';
import { createApp } from '../server.js';

const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'eat-usage-')), 'data', 'usage.json');

test('currentMonth は太平洋時間で月を区切る', () => {
  // 日本時間 11/1 09:00 = 太平洋時間 10/31 17:00
  assert.equal(currentMonth(new Date('2026-11-01T00:00:00Z')), '2026-10');
  assert.equal(currentMonth(new Date('2026-11-01T08:00:00Z')), '2026-11');
});

test('上限までは確保でき、超える分は 1 回も数えずに止める', () => {
  const usage = createUsage({ file: tempFile(), limits: { text: 5, nearby: 10 } });
  usage.reserve('nearby', 7);
  assert.throws(() => usage.reserve('nearby', 7), (err) => err.status === 429 && /上限 \(10回\)/.test(err.message));
  usage.reserve('nearby', 3);
  assert.deepEqual(
    usage.summary().items.map(({ kind, used }) => [kind, used]),
    [['text', 0], ['nearby', 10]],
  );
});

test('回数はファイルに保存され、再起動後も引き継がれる', () => {
  const file = tempFile();
  createUsage({ file, limits: { text: 5, nearby: 10 } }).reserve('text', 2);
  const restarted = createUsage({ file, limits: { text: 5, nearby: 10 } });
  assert.equal(restarted.summary().items.find((i) => i.kind === 'text').used, 2);
});

test('月が変わると回数がリセットされる', () => {
  let now = new Date('2026-10-15T00:00:00Z');
  const usage = createUsage({ file: tempFile(), limits: { text: 5, nearby: 10 }, now: () => now });
  usage.reserve('nearby', 10);
  assert.throws(() => usage.reserve('nearby', 1));
  now = new Date('2026-11-15T00:00:00Z');
  usage.reserve('nearby', 7);
  assert.equal(usage.summary().month, '2026-11');
  assert.equal(usage.summary().items.find((i) => i.kind === 'nearby').used, 7);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('remaining は残り回数を返す', () => {
  const usage = createUsage({ file: tempFile(), limits: { text: 5, nearby: 10 } });
  usage.reserve('nearby', 7);
  assert.equal(usage.remaining('nearby'), 3);
  assert.equal(usage.remaining('text'), 5);
});

test('上限に達したら Google を呼ばずに 429 を返す', async () => {
  let googleCalls = 0;
  const usage = createUsage({ file: tempFile(), limits: { text: 100, nearby: 10 } });
  const server = createApp({ apiKey: 'KEY', usage });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return realFetch(url, init);
    googleCalls++;
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  };

  try {
    const first = await fetch(`${base}/api/search?lat=35.17&lng=136.88`);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).usage.items.find((i) => i.kind === 'nearby').used, 7);
    assert.equal(googleCalls, 7);

    // 同じ地点はキャッシュから返すので数えない
    assert.equal((await fetch(`${base}/api/search?lat=35.17&lng=136.88`)).status, 200);
    assert.equal(googleCalls, 7);

    const second = await fetch(`${base}/api/search?lat=35.68&lng=139.76`);
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /上限/);
    assert.equal(googleCalls, 7);

    // 周辺検索の枠がなければ、地名検索も呼ばず回数も減らさない
    const byName = await fetch(`${base}/api/search?q=${encodeURIComponent('名古屋駅')}`);
    assert.equal(byName.status, 429);
    assert.equal(googleCalls, 7);

    const summary = await (await fetch(`${base}/api/config`)).json();
    assert.equal(summary.usage.items.find((i) => i.kind === 'nearby').used, 7);
    assert.equal(summary.usage.items.find((i) => i.kind === 'text').used, 0);
  } finally {
    server.close();
  }
});

test('写真は残りの枠の分だけ取り、詳細の枠がなければ 429', async () => {
  const usage = createUsage({ file: tempFile(), limits: { text: 10, nearby: 10, details: 1, photo: 2 } });
  const server = createApp({ apiKey: 'KEY', usage });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const googleUrls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return realFetch(url, init);
    googleUrls.push(String(url));
    if (String(url).includes('/media')) {
      return new Response(JSON.stringify({ photoUri: `https://photo.example/${googleUrls.length}` }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: 'abc',
      displayName: { text: '店' },
      photos: [1, 2, 3, 4].map((i) => ({ name: `places/abc/photos/p${i}` })),
    }), { status: 200 });
  };

  try {
    const res = await fetch(`${base}/api/place?id=abc`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.place.photos.length, 2);
    assert.equal(googleUrls.filter((u) => u.includes('/media')).length, 2);
    assert.deepEqual(
      body.usage.items.filter((i) => ['details', 'photo'].includes(i.kind)).map((i) => i.used),
      [1, 2],
    );

    const other = await fetch(`${base}/api/place?id=xyz`);
    assert.equal(other.status, 429);
    assert.equal(googleUrls.length, 3);
  } finally {
    server.close();
  }
});
