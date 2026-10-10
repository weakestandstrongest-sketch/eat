import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

let server;
let base;

before(async () => {
  server = createApp({ demo: true });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('地名で検索するとジャンル別の結果が返る', async () => {
  const res = await fetch(`${base}/api/search?q=${encodeURIComponent('名古屋駅')}&radius=1000`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.demo, true);
  assert.equal(body.center.name, '名古屋駅');
  assert.equal(body.radius, 1000);
  const washoku = body.categories.find((c) => c.id === 'washoku');
  assert.equal(washoku.label, '和食');
  assert.ok(washoku.restaurants.length > 0);
  for (const r of washoku.restaurants) {
    assert.equal(r.category, 'washoku');
    assert.ok(r.distance <= 1000);
  }
});

test('緯度経度 (現在地) で検索できる', async () => {
  const res = await fetch(`${base}/api/search?lat=35.68&lng=139.76`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.center.name, '現在地');
  assert.equal(body.radius, 1000);
});

test('rank=distance を受け付けて結果に含める', async () => {
  const body = await (await fetch(`${base}/api/search?lat=35.17&lng=136.88&rank=distance`)).json();
  assert.equal(body.rank, 'distance');
  const r = body.categories[0].restaurants[0];
  assert.equal(typeof r.lat, 'number');
  assert.equal(typeof r.lng, 'number');
});

test('店舗詳細を返す', async () => {
  const res = await fetch(`${base}/api/place?id=demo-washoku-1`);
  assert.equal(res.status, 200);
  const { place } = await res.json();
  assert.match(place.name, /まるやま/);
  assert.equal(place.hours.length, 7);
  assert.ok(place.reviews.length >= 3);
});

test('店舗詳細: 不正な ID は 400、存在しない ID は 404', async () => {
  assert.equal((await fetch(`${base}/api/place?id=${encodeURIComponent('../x')}`)).status, 400);
  assert.equal((await fetch(`${base}/api/place?id=nope`)).status, 404);
});

test('設定を返す', async () => {
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(config, { demo: true, embedKey: null, usage: null });
});

test('場所の指定がなければ 400', async () => {
  const res = await fetch(`${base}/api/search`);
  assert.equal(res.status, 400);
});

test('トップページと静的ファイルを返す', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /ごはんサーチ/);
  assert.equal((await fetch(`${base}/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
});

test('public の外のファイルは返さない', async () => {
  const res = await fetch(`${base}/%2e%2e/server.js`);
  assert.notEqual(res.status, 200);
});
