import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { geocode, getPlaceDetails, searchRestaurants } from './lib/places.js';
import { demoDetails, demoGeocode, demoSearch } from './lib/demo.js';
import { CATEGORIES } from './lib/categories.js';
import { createUsage, UsageLimitError } from './lib/usage.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CACHE_TTL_MS = 10 * 60 * 1000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

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

// usage を渡すと Google Places API の呼び出し回数を数えて月間上限で止める (デモでは不要)。
// embedKey はブラウザに渡す Maps Embed API 用のキー (Places API のキーとは別にする)。
export function createApp({ apiKey = '', demo = !apiKey, usage = null, embedKey = '' } = {}) {
  const cached = createCache();

  const provider = demo
    ? {
        geocode: async (q) => demoGeocode(q),
        search: async (p) => demoSearch(p),
        details: async (id) => demoDetails(id),
      }
    : {
        geocode: (q) => {
          // 周辺検索の枠がもうないなら、地名検索の分も使わずに止める
          usage?.ensure('nearby', CATEGORIES.length);
          usage?.reserve('text', 1);
          return geocode(q, apiKey);
        },
        search: (p) => {
          usage?.reserve('nearby', CATEGORIES.length);
          return searchRestaurants(p, apiKey);
        },
        details: (id) => {
          usage?.reserve('details', 1);
          return getPlaceDetails(id, apiKey, {
            // 写真は残りの枠の分だけ取る (枠がなくても詳細は表示する)
            reservePhotos: (n) => {
              if (!usage) return n;
              const allowed = Math.min(n, usage.remaining('photo'));
              if (allowed > 0) usage.reserve('photo', allowed);
              return allowed;
            },
          });
        },
      };

  async function handleSearch(url, res) {
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
      if (!center) return sendJson(res, 404, { error: `「${q}」が見つかりませんでした` });
    } else {
      return sendJson(res, 400, { error: '場所 (q) か現在地 (lat, lng) を指定してください' });
    }

    const key = `search:${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radius},${rank}`;
    const categories = await cached(key, () =>
      provider.search({ lat: center.lat, lng: center.lng, radius, rank }),
    );
    sendJson(res, 200, { demo, center, radius, rank, categories, usage: usage?.summary() ?? null });
  }

  async function handlePlace(url, res) {
    const id = url.searchParams.get('id') ?? '';
    if (!/^[\w-]{1,300}$/.test(id)) return sendJson(res, 400, { error: '店舗 ID が正しくありません' });
    const place = await cached(`place:${id}`, () => provider.details(id));
    if (!place) return sendJson(res, 404, { error: 'お店が見つかりませんでした' });
    sendJson(res, 200, { demo, place, usage: usage?.summary() ?? null });
  }

  async function serveStatic(url, res) {
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const filePath = path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method !== 'GET') {
        res.writeHead(405).end();
      } else if (url.pathname === '/api/search') {
        await handleSearch(url, res);
      } else if (url.pathname === '/api/place') {
        await handlePlace(url, res);
      } else if (url.pathname === '/api/config') {
        sendJson(res, 200, { demo, embedKey: embedKey || null, usage: usage?.summary() ?? null });
      } else {
        await serveStatic(url, res);
      }
    } catch (err) {
      if (err instanceof UsageLimitError) {
        sendJson(res, 429, { error: err.message, usage: usage?.summary() ?? null });
        return;
      }
      console.error(err);
      sendJson(res, 502, { error: `Google からの取得に失敗しました: ${err.message}` });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile();
  } catch {
    // .env がなければ環境変数だけで動かす
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
  const demo = !apiKey || process.env.DEMO === '1';
  const port = Number(process.env.PORT) || 3000;
  const usage = demo
    ? null
    : createUsage({
        file: process.env.USAGE_FILE || path.join(ROOT_DIR, 'data', 'usage.json'),
        limits: {
          text: Number(process.env.MONTHLY_LIMIT_TEXT) || 5000,
          nearby: Number(process.env.MONTHLY_LIMIT_NEARBY) || 1000,
          details: Number(process.env.MONTHLY_LIMIT_DETAILS) || 1000,
          photo: Number(process.env.MONTHLY_LIMIT_PHOTO) || 1000,
        },
      });
  const embedKey = process.env.GOOGLE_MAPS_EMBED_KEY ?? '';
  createApp({ apiKey, demo, usage, embedKey }).listen(port, () => {
    console.log(`http://localhost:${port}`);
    if (demo) console.log('デモモードで起動しました (架空のデータを表示します)');
    for (const item of usage?.summary().items ?? []) {
      console.log(`今月の${item.label}: ${item.used} / ${item.limit} 回`);
    }
  });
}
