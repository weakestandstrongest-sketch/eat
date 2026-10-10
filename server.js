// PC で動かすときのサーバー。API は lib/app.js、画面は public/ のファイルを返す。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHandler } from './lib/app.js';
import { createUsage, limitsFromEnv } from './lib/usage.js';
import { fileStore } from './lib/usage-file.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

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

// Node の req を標準の Request に変える
async function toRequest(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body });
}

async function sendResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

// 引数は lib/app.js の createHandler と同じ
export function createApp(options = {}) {
  const handle = createHandler(options);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      const response = await handle(await toRequest(req, url));
      if (response) await sendResponse(res, response);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(url, res);
      else res.writeHead(405).end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end();
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
        store: fileStore(process.env.USAGE_FILE || path.join(ROOT_DIR, 'data', 'usage.json')),
        limits: limitsFromEnv(process.env),
      });
  const embedKey = process.env.GOOGLE_MAPS_EMBED_KEY ?? '';
  createApp({ apiKey, demo, usage, embedKey }).listen(port, async () => {
    console.log(`http://localhost:${port}`);
    if (demo) console.log('デモモードで起動しました (架空のデータを表示します)');
    for (const item of (await usage?.summary())?.items ?? []) {
      console.log(`今月の${item.label}: ${item.used} / ${item.limit} 回`);
    }
  });
}
