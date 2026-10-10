// /api/* と /login を処理する。PC (server.js) と Cloudflare Workers (worker.js) の両方で使う。
// 標準の Request / Response で書いているので、どちらの環境でもそのまま動く。
import { CATEGORIES } from './categories.js';
import { demoDetails, demoGeocode, demoSearch } from './demo.js';
import { geocode, getPlaceDetails, searchRestaurants } from './places.js';
import { UsageLimitError } from './usage.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const AUTH_COOKIE = 'eat_auth';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

// 同じ地点の再検索で API を叩き直さないための簡易キャッシュ
function createCache() {
  const entries = new Map();
  return async (key, load) => {
    const hit = entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await load();
    entries.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  };
}

// パスワードから作る合言葉。パスワードを変えると、それまでのログインは無効になる
async function authToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('eat-auth-v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function loginPage(error = '') {
  const message = error ? `<p class="status status-error">${error}</p>` : '';
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#d9480f">
  <title>ログイン - ごはんサーチ</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="main login">
    <h1 class="title">🍚 ごはんサーチ</h1>
    <p class="lead">パスワードを入れてください</p>
    <form method="post" action="/login" class="search">
      <input class="search-input" type="password" name="password" autocomplete="current-password" required autofocus aria-label="パスワード">
      <button class="btn btn-primary" type="submit">ログイン</button>
    </form>
    ${message}
  </main>
</body>
</html>`;
}

const html = (status, body) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// usage を渡すと Google Places API の呼び出し回数を数えて月間上限で止める (デモでは不要)。
// embedKey はブラウザに渡す Maps Embed API 用のキー (Places API のキーとは別にする)。
// password を渡すと、/api/* はログインした人しか使えなくなる。
// 返す関数は、担当外のパス (画面のファイルなど) には null を返す。
export function createHandler({ apiKey = '', demo = !apiKey, usage = null, embedKey = '', password = '' } = {}) {
  const cached = createCache();
  const tokenPromise = password ? authToken(password) : null;

  const provider = demo
    ? {
        geocode: async (q) => demoGeocode(q),
        search: async (p) => demoSearch(p),
        details: async (id) => demoDetails(id),
      }
    : {
        geocode: async (q) => {
          // 周辺検索の枠がもうないなら、地名検索の分も使わずに止める
          await usage?.ensure('nearby', CATEGORIES.length);
          await usage?.reserve('text', 1);
          return geocode(q, apiKey);
        },
        search: async (p) => {
          await usage?.reserve('nearby', CATEGORIES.length);
          return searchRestaurants(p, apiKey);
        },
        details: async (id) => {
          await usage?.reserve('details', 1);
          return getPlaceDetails(id, apiKey, {
            // 写真は残りの枠の分だけ取る (枠がなくても詳細は表示する)
            reservePhotos: async (n) => (usage ? usage.reserveUpTo('photo', n) : n),
          });
        },
      };

  const summary = async () => (usage ? usage.summary() : null);

  async function isLoggedIn(request) {
    if (!tokenPromise) return true;
    const cookie = readCookie(request, AUTH_COOKIE);
    return cookie != null && safeEqual(cookie, await tokenPromise);
  }

  async function handleLogin(request, url) {
    if (!password) return Response.redirect(new URL('/', url), 303);
    if (request.method !== 'POST') return html(200, loginPage());
    const form = await request.formData().catch(() => null);
    const input = String(form?.get('password') ?? '');
    if (!safeEqual(await authToken(input), await tokenPromise)) {
      // 総当たりで当てられにくいよう、間違えたら少し待たせる
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return html(401, loginPage('パスワードが違います'));
    }
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Set-Cookie': `${AUTH_COOKIE}=${await tokenPromise}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
      },
    });
  }

  async function handleSearch(url) {
    const q = url.searchParams.get('q')?.trim();
    const lat = Number.parseFloat(url.searchParams.get('lat'));
    const lng = Number.parseFloat(url.searchParams.get('lng'));
    const radius = Math.min(Math.max(Number.parseInt(url.searchParams.get('radius'), 10) || 1000, 100), 5000);
    const rank = url.searchParams.get('rank') === 'distance' ? 'distance' : 'popularity';

    let center;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      center = { name: '現在地', address: '', lat, lng };
    } else if (q) {
      center = await cached(`geo:${q}`, () => provider.geocode(q));
      if (!center) return json(404, { error: `「${q}」が見つかりませんでした` });
    } else {
      return json(400, { error: '場所 (q) か現在地 (lat, lng) を指定してください' });
    }

    const key = `search:${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radius},${rank}`;
    const categories = await cached(key, () =>
      provider.search({ lat: center.lat, lng: center.lng, radius, rank }),
    );
    return json(200, { demo, center, radius, rank, categories, usage: await summary() });
  }

  async function handlePlace(url) {
    const id = url.searchParams.get('id') ?? '';
    if (!/^[\w-]{1,300}$/.test(id)) return json(400, { error: '店舗 ID が正しくありません' });
    const place = await cached(`place:${id}`, () => provider.details(id));
    if (!place) return json(404, { error: 'お店が見つかりませんでした' });
    return json(200, { demo, place, usage: await summary() });
  }

  return async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/login') return handleLogin(request, url);
    if (!url.pathname.startsWith('/api/')) return null;

    if (request.method !== 'GET') return json(405, { error: 'Method Not Allowed' });
    if (!(await isLoggedIn(request))) return json(401, { error: 'ログインしてください', login: true });
    try {
      switch (url.pathname) {
        case '/api/search':
          return await handleSearch(url);
        case '/api/place':
          return await handlePlace(url);
        case '/api/config':
          return json(200, { demo, embedKey: embedKey || null, usage: await summary() });
        default:
          return json(404, { error: 'Not Found' });
      }
    } catch (err) {
      if (err instanceof UsageLimitError) {
        return json(429, { error: err.message, usage: await summary() });
      }
      console.error(err);
      return json(502, { error: `Google からの取得に失敗しました: ${err.message}` });
    }
  };
}
