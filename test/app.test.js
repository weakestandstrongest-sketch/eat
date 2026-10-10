import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/app.js';

const BASE = 'https://eat.example.workers.dev';
const handle = createHandler({ demo: true, password: 'correct-horse' });

async function login(password) {
  return handle(new Request(`${BASE}/login`, {
    method: 'POST',
    body: new URLSearchParams({ password }),
  }));
}

test('担当外のパスには null を返す (画面のファイルは別で返す)', async () => {
  assert.equal(await handle(new Request(`${BASE}/`)), null);
  assert.equal(await handle(new Request(`${BASE}/app.js`)), null);
});

test('パスワードを設定すると、ログインしないと API を使えない', async () => {
  const res = await handle(new Request(`${BASE}/api/config`));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).login, true);
});

test('ログイン画面を返す', async () => {
  const res = await handle(new Request(`${BASE}/login`));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /type="password"/);
});

test('パスワードが違うと 401', async () => {
  const res = await login('wrong-password');
  assert.equal(res.status, 401);
  assert.match(await res.text(), /パスワードが違います/);
});

test('正しいパスワードで Cookie がもらえ、API を使える', async () => {
  const res = await login('correct-horse');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/');
  const cookie = res.headers.get('Set-Cookie');
  assert.match(cookie, /^eat_auth=[0-9a-f]{64}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);

  const api = await handle(new Request(`${BASE}/api/config`, { headers: { Cookie: cookie.split(';')[0] } }));
  assert.equal(api.status, 200);
  assert.equal((await api.json()).demo, true);
});

test('Cookie が偽物なら 401', async () => {
  const res = await handle(new Request(`${BASE}/api/config`, { headers: { Cookie: `eat_auth=${'0'.repeat(64)}` } }));
  assert.equal(res.status, 401);
});

test('パスワードなしなら誰でも使え、/login はトップへ移る', async () => {
  const open = createHandler({ demo: true });
  assert.equal((await open(new Request(`${BASE}/api/config`))).status, 200);
  const res = await open(new Request(`${BASE}/login`));
  assert.equal(res.status, 303);
});
