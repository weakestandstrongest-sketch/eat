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

    const summary = await (await fetch(`${base}/api/usage`)).json();
    assert.equal(summary.usage.items.find((i) => i.kind === 'nearby').used, 7);
    assert.equal(summary.usage.items.find((i) => i.kind === 'text').used, 0);
  } finally {
    server.close();
  }
});
